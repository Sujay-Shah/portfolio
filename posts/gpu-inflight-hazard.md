# GPU In-Flight Hazards: Why Resize Crashes and How to Fix It

Of all the bugs you'll encounter writing a Vulkan renderer, the GPU in-flight hazard is the most insidious. It doesn't always crash. It doesn't always trigger validation layers. And when it does crash, the stack trace points somewhere deep inside the driver—not at the line of code you forgot to protect.

This is the story of how a window resize event caused intermittent crashes in Usul's editor, and the one-call fix.

---

## The Setup: Triple-Buffered Frame Resources

Usul's renderer is structured around triple-buffered frame resources—the standard recipe for keeping the CPU and GPU busy in parallel without stalls. There are `k_MaxFrames = 3` frames in flight at any given time. Each frame owns its own command buffer, fence, and semaphores:

```cpp
struct FrameContext
{
    CmdBuf    cmd         = {};   // primary graphics command buffer
    Fence     fence       = {};   // CPU waits on this before reusing the frame
    Semaphore image_ready = {};   // swapchain image acquisition signal
    Semaphore render_done = {};   // present waits on this
    u32       index       = 0;    // 0..MAX_FRAMES_IN_FLIGHT-1
};
```

At the start of each frame, the CPU waits on `frame.fence` before reusing that frame's command buffer—guaranteeing the GPU has finished with it before we record new commands into it. This is the *per-frame* CPU-GPU sync point. It works perfectly, as long as nothing else touches GPU resources between frames.

---

## The Bug: Resize Fires Mid-Frame

GLFW delivers window resize events through a callback. In Usul, this callback is registered in the engine's event system:

```cpp
// EngineApp.cpp
void EngineApp::OnEvent(Event& e)
{
    EventDispatcher dispatcher(e);
    dispatcher.Dispatch<WindowResizeEvent>(ENGINE_BIND_EVENT_FN(EngineApp::OnWindowResizeEvent));
    // ...
}

bool EngineApp::OnWindowResizeEvent(WindowResizeEvent& e)
{
    // ...
    rhi::swapchain_resize((uint32_t)fb_width, (uint32_t)fb_height);
    return false;
}
```

And `swapchain_resize` calls `vk_swapchain_destroy` then re-creates—which looked like this in the early version of `vkrhi.cpp`:

```cpp
static bool vk_swapchain_resize(u32 w, u32 h)
{
    vk_swapchain_destroy();  // <-- PROBLEM
    // ...re-create swapchain...
}

static void vk_swapchain_destroy()
{
    // Destroys VkImageViews and the VkSwapchainKHR
    for (u32 i = 0; i < g_ctx.sw_count; ++i)
        vkDestroyImageView(g_ctx.device, g_ctx.sw_views[i], nullptr);
    vkDestroySwapchainKHR(g_ctx.device, g_ctx.swapchain, nullptr);
    vkDestroySurfaceKHR(g_ctx.instance, g_ctx.surface, nullptr);
}
```

The event is delivered while the main loop is running. On some frames, `OnWindowResizeEvent` fires while the GPU is actively processing commands for the *previous* frame—commands that reference the exact `VkImage` handles inside the swapchain. `vkDestroyImageView` doesn't block. It schedules destruction. And then Vulkan tries to sample from an image that no longer exists.

---

## Symptoms

The crash wasn't deterministic. It manifested in three different ways depending on timing:

**1. Hard crash inside the driver:**
```
Thread 1: EXC_BAD_ACCESS (SIGSEGV)
Frame 0: libvulkan.dylib`vkCmdPipelineBarrier
```

**2. Vulkan validation layer error:**
```
VUID-vkDestroyImageView-imageView-01026:
Cannot call vkDestroyImageView on VkImageView 0x... that is currently in use by a command buffer.
```

**3. Flicker followed by a black frame**, then the next resize worked fine. This happened when the driver was lenient—the image was destroyed but the GPU had already finished with it by the time it was actually freed.

Because the crash was timing-dependent, it would reproduce consistently when you resized the window rapidly but not at all when you resized slowly.

---

## Debugging

The first instinct was to look at the fence wait logic. Was the per-frame fence working? Adding logging confirmed it was—`fence_wait` was completing correctly before each frame's command buffer was reused. The per-frame sync wasn't the problem.

The key realization came when thinking about the *swapchain textures themselves*. They're not owned by any single frame context. The swapchain holds `sw_count` images (typically 3), wrapped in `TextureSlot` handles. The geometry pass, the lighting pass, ImGui's present pass—all of them reference backbuffer textures. The per-frame fence only guarantees that **one** frame's command buffer is done. There are up to `k_MaxFrames - 1` other frames still potentially in flight.

This is the crucial distinction:

> The per-frame fence protects the **command buffer**. It does not protect the **resources that command buffer referenced**.

When `vk_swapchain_destroy()` fires from an event callback in the middle of frame N's main loop iteration, frames N-1 and N-2 may still have active command buffers executing on the GPU that reference swapchain images.

---

## The Fix: Block the Entire GPU

The solution is one line:

```cpp
static void vk_swapchain_destroy()
{
    vkDeviceWaitIdle(g_ctx.device);  // Wait for ALL queues to drain
    for (u32 i = 0; i < g_ctx.sw_count; ++i)
        s_textures.free(g_ctx.sw_handles[i]);
    for (u32 i = 0; i < g_ctx.sw_count; ++i)
        vkDestroyImageView(g_ctx.device, g_ctx.sw_views[i], nullptr);
    vkDestroySwapchainKHR(g_ctx.device, g_ctx.swapchain, nullptr);
    vkDestroySurfaceKHR(g_ctx.instance, g_ctx.surface, nullptr);
}
```

`vkDeviceWaitIdle` blocks the calling CPU thread until every queue on the logical device has completely drained. Not just the graphics queue—the compute and transfer queues too. After it returns, there is zero GPU work in flight. Any Vulkan object can be safely destroyed.

The same guard appears in `SceneRenderer::Shutdown()` and `SceneRenderer::Resize()`:

```cpp
void SceneRenderer::Shutdown()
{
    if (!m_Initialised) return;
    rhi::device_wait_idle();   // GPU drains before any resource is freed
    DestroyGBuffer();
    DestroyLightPassTargets();
    // ...
}

void SceneRenderer::Resize(uint32_t w, uint32_t h)
{
    if (w == m_Width && h == m_Height) return;
    rhi::device_wait_idle();   // Same guard before G-Buffer texture realloc
    m_Width = w; m_Height = h;
    DestroyGBuffer();
    DestroyLightPassTargets();
    CreateGBuffer(w, h);
    CreateLightPassTargets(w, h);
}
```

---

## The Performance Question

`vkDeviceWaitIdle` is a stall. It stops the pipeline and waits. Is it acceptable?

In Usul's case: **yes, for resize and shutdown**. Resize is a rare, user-triggered event. A 1–3 ms GPU drain is invisible compared to the latency of the user dragging a window edge. Shutdown similarly benefits from the guarantee of clean teardown over speed.

Where it's *not* acceptable is in the main render loop. Inside `GetEntityAtPixel`—the mouse-click-to-entity picker that reads back a pixel from the `m_GEntityID` buffer—there's also a `device_wait_idle()` call:

```cpp
int SceneRenderer::GetEntityAtPixel(int x, int y)
{
    rhi::device_wait_idle();  // must wait for GPU to finish writing GEntityID
    // ... issue readback copy and fence-wait ...
}
```

This one is acknowledged as a known performance wart. For interactive picking on a mouse click (not per-frame), it's acceptable. For a production system, you'd replace this with a ring-buffered readback that checks a per-frame fence instead of stalling the device.

---

## The Rule

Every code path that destroys a GPU resource must be preceded by a synchronization guarantee strong enough to cover every frame that could possibly be using that resource. The per-frame fence protects *that frame's command buffer*. For resources shared across multiple frames—swapchain images, G-Buffer textures, persistent samplers—the synchronization scope must be correspondingly wider.

```cpp
rhi::device_wait_idle(); // Before any resource realloc on resize or shutdown
rhi::texture_destroy(s_ColorTex);
// Safe to recreate here
```

It's the simplest possible contract: the GPU is idle, destroy what you want.
