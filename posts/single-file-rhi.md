# From OOP to a Flat Vtable: Rethinking the RHI in a Single-File Architecture

At some point while building Usul's rendering backend, I hit a wall. Adding a second graphics API—WebGPU—to what was already a class-heavy Vulkan abstraction turned into a week-long exercise in untangling inheritance chains, resolving circular header includes, and wondering how a "clean" architecture had become so hard to extend.

This is the story of why I tore it down and rewrote the entire RHI into a flat, function-pointer dispatch model living in essentially **three files**: `rhi_types.hpp`, `rhi.hpp`, and one backend `.cpp` per API.

---

## The Original Design: OOP Felt Right, Until It Didn't

The first version of Usul's RHI followed the standard game-engine textbook approach: a hierarchy of abstract C++ classes.

```
IRHIDevice      ← pure interface
  └─ VulkanDevice.cpp
  └─ DX12Device.cpp

IRHICommandContext
  └─ VulkanCommandContext.cpp
  └─ DX12CommandContext.cpp

IRHIResource
  └─ VulkanBuffer.cpp / DX12Buffer.cpp
  └─ VulkanTexture.cpp / DX12Texture.cpp
  └─ VulkanSwapChain.cpp / DX12SwapChain.cpp
```

Each resource type got its own pair of files. Buffers lived in `VulkanBuffer.cpp`, textures in `VulkanTexture.cpp`, the swapchain in `VulkanSwapChain.cpp`, the command context in `VulkanCommandContext.cpp`, and so on. The idea was classic: each subsystem has a single responsibility, and the virtual interface enforces the contract.

Here's how resource creation and command recording looked:

```cpp
// Resource creation through the abstract device
RHIBuffer* device->CreateBuffer(desc, initialData);
RHITexture* device->CreateTexture(texDesc);

// Command recording through the abstract context
context->TransitionBarrier(texture, ResourceState::ShaderRead);
context->BindPipelineState(pso);
context->BindDescriptorSet(set);
context->DrawIndexed(count, 1, 0, 0, 0);
```

Clean at a glance. But here's what it looked like behind the scenes.

---

## What Went Wrong: Death by a Thousand Seams

### 1. Cross-File State is a Maintenance Nightmare

Vulkan doesn't exist in nice isolated modules. To issue a `vkCmdDraw`, your command context needs:

- The `VkCommandBuffer` (owned by the context)
- The `VkPipelineLayout` (stored on the pipeline, which is in a different object)
- The `VkDescriptorPool` (managed by the device, referenced through a pointer)
- The current `VkSwapchainKHR` image index (owned by the swapchain object)
- The `VmaAllocator` (device-level, but needed in every buffer creation)

In the class-based design, each of these lived in a different `.cpp` file. Sharing state meant either storing raw pointers to foreign objects, passing a `VulkanDevice*` into every constructor, or using singletons. The codebase accumulated a web of pointers with no clear ownership graph. When I needed to resize the swapchain, I had to track which objects held a reference to it—and pray I didn't miss one before destroying it.

### 2. Every New API Required Forking Every File

Adding WebGPU—the concrete catalyst for this refactor—meant creating:

```
wgpu/WGPUDevice.cpp
wgpu/WGPUCommandContext.cpp
wgpu/WGPUBuffer.cpp
wgpu/WGPUTexture.cpp
wgpu/WGPUSampler.cpp
wgpu/WGPUPipeline.cpp
wgpu/WGPUSwapChain.cpp
```

Seven new files, each needing a new `#include` chain, each needing the same global state threaded through as pointer arguments. And any time a new capability was added to `IRHIDevice`—say, adding `cmd_dispatch_indirect`—it required touching every backend's file just to add a stub or an implementation.

### 3. Virtual Dispatch Isn't Free (Nor Is It Free From Bugs)

With resource objects being `new`-allocated `IRHIResource*` pointers, every buffer create or texture destroy went through heap allocation and a vtable lookup. More critically, the compiler couldn't inline anything because the call site only ever saw the abstract interface. In a tight rendering loop with thousands of draw calls, this added measurable overhead in debug builds and prevented meaningful optimization in release builds.

The subtler bug: because `IRHIResource` had a virtual destructor and subclass data, you could inadvertently `delete` an `IRHITexture*` through the base class before the GPU was finished using it—and it would "work" until the validation layers caught it six frames later as a use-after-free.

### 4. Headers Included Vulkan Everywhere

`VulkanBuffer.h` needed `<vulkan/vulkan.h>`. `VulkanCommandContext.h` needed `VulkanBuffer.h`. Every `.cpp` in the engine that used `IRHICommandContext` was—through transitive includes—pulling in the entirety of `<vulkan/vulkan.h>`. The result: several-second incremental rebuild times for any change anywhere near the RHI boundary.

---

## The Refactor: Collapse It All

The insight was simple: **all global state that these scattered classes shared was actually one piece of state**. The Vulkan device context (`VkInstance`, `VkDevice`, `VkPhysicalDevice`, queues, pools, the swapchain) belongs together. So does every resource pool.

Instead of a family of class files, I wrote a single struct of function pointers:

```cpp
// rhi.hpp — the ONLY file application code ever includes
struct BackendApi
{
    bool (*init)          (const InitDesc&);
    void (*shutdown)      ();

    Buffer       (*buffer_create) (const BufferDesc&);
    void         (*buffer_destroy)(Buffer);

    Texture (*texture_create) (const TextureDesc&);
    void    (*texture_destroy)(Texture);

    void (*cmd_bind_pipeline)      (CmdBuf, Pipeline);
    void (*cmd_draw_indexed)       (CmdBuf, const DrawIndexedCmd&);
    void (*cmd_texture_barrier)    (CmdBuf, const TextureBarrier*, u32 count);
    // ... all ~50 operations
};

extern const BackendApi* g_rhi;
```

And every call site becomes a single-load indirect call:

```cpp
// Instead of: device->CreateBuffer(desc)
rhi::Buffer vb = rhi::buffer_create({ .size = sizeof(verts), .usage = BufferUsage::Vertex });

// Instead of: context->DrawIndexed(...)
rhi::draw_indexed(cmd, { .index_count = mesh.indexCount });
```

The `g_rhi` pointer is set once at startup:

```cpp
// rhi.cpp — the entire dispatch layer
bool rhi::init(const InitDesc& desc)
{
    switch (desc.backend) {
    case Backend::Vulkan:  g_rhi = vkrhi::get_api();   break;
    case Backend::WebGPU:  g_rhi = wgpu_rhi::get_api(); break;
    default: return false;
    }
    return g_rhi->init(desc);
}
```

That's the whole dispatch layer. One `.cpp` file, 77 lines.

---

## The Handle System: Type Safety Without Object Overhead

Resources are no longer heap-allocated objects. They're **32-bit generation-tagged handles**:

```cpp
template<typename Tag>
struct Handle {
    u32 id = 0;          // bits [19:0] = slot index, bits [31:20] = generation

    explicit constexpr operator bool() const noexcept { return id != 0; }
    [[nodiscard]] constexpr u32 index() const noexcept { return  id        & HANDLE_INDEX_MASK; }
    [[nodiscard]] constexpr u32 gen()   const noexcept { return (id >> 20) & HANDLE_GEN_MASK;   }
};

// One tag type per resource kind — never instantiated
struct BufferTag  {};
struct TextureTag {};

using Buffer  = Handle<BufferTag>;
using Texture = Handle<TextureTag>;
```

Passing a `Texture` where a `Buffer` is expected is a **compile error**, not a silent runtime bug. And because handles are just `u32`s, they're trivially copyable, stackable in arrays, and zero-cost to pass around. The actual `VkBuffer`/`WGPUBuffer` lives in a statically-allocated pool inside the backend `.cpp`—invisible to the caller.

The generation counter is the safety net: when a slot is freed and reallocated, the generation increments. A dangling `Buffer` handle from before the free will have a stale generation; the pool's `get_checked()` returns null and asserts in debug builds.

```cpp
// Inside vkrhi.cpp — backend's internal pool lookup
static rhi::Buffer vk_buffer_create(const rhi::BufferDesc& desc)
{
    rhi::Buffer h = s_buffers.alloc();       // returns a handle with current gen
    BufferSlot& slot = s_buffers.get_checked(h);
    // ... vmaCreateBuffer into slot.vk_buffer
    return h;
}
```

---

## Adding WebGPU: Exactly the Proof

When I eventually got around to adding the WebGPU backend, the process was:

1. Add `WebGPU` to the `Backend` enum in `rhi_types.hpp`.
2. Create `wgpurhi_internal.hpp` for internal slot types (`WGPUBuffer`, `WGPUTexture`, etc.).
3. Implement all ~50 function slots in `wgpurhi.cpp`.
4. Add three lines to `rhi.cpp`'s `init()` switch.

Zero changes to application code. Zero changes to `rhi.hpp`. Zero changes to `SceneRenderer.cpp`. The engine rendered through WebGPU on the first compile.

With the class-based design, adding a backend would have meant forking seven files, threading a new device pointer through all of them, and auditing every virtual override.

---

## The File Count Comparison

| Architecture | Files per Backend | Application-Facing Headers |
|---|---|---|
| OOP class hierarchy | ~7–10 `.cpp` + `.h` pairs | `IRHIDevice.h`, `IRHICommandContext.h`, `IRHIResource.h`, ... |
| Flat vtable dispatch | **1 `*rhi_internal.hpp` + 1 `*rhi.cpp`** | **`rhi.hpp` only** |

---

## Tradeoffs: What You Give Up

This design isn't without its own rough edges.

**The `BackendApi` struct is a single point of change.** Adding a new operation (say, `cmd_trace_rays` for ray tracing) requires editing `rhi.hpp` and implementing the slot in *every* compiled backend. With the class hierarchy, you could add a default no-op in the base class; here, missing a slot is a linker error or a crash depending on initialization order.

**No subclassing means no easy extensions.** If you want per-backend debug overhead (e.g., injecting GPU timing queries around every command), you have to add it inside the backend `.cpp` or thread it through a wrapper. The OOP model made it easier to slot in a `RHIDebugCommandContext : VulkanCommandContext` decorator.

**Global state is now truly global.** The entire Vulkan context (`VkDevice`, `VmaAllocator`, all pools) lives in anonymous static globals inside `vkrhi.cpp`. This is fine for a single-device engine—which most game engines are—but precludes multi-GPU without significant redesign.

---

## Problems Tackled Along the Way

Several non-obvious issues surfaced during the migration that are worth documenting separately:

- **GPU In-Flight Hazards on Resize / Shutdown** — destroying a swapchain texture while the GPU is actively sampling it produces a hard crash. The fix: always call `rhi::device_wait_idle()` before *any* resource destruction in response to window events.

- **Descriptor Set Invalidation During Frame Recording** — a validation error triggered by calling `descriptor_set_write()` on the same per-frame descriptor set for each mesh in the geometry pass. Because Vulkan prohibits updating a descriptor set that's already been recorded into a command buffer (without `UPDATE_AFTER_BIND`), writing new descriptors mid-loop for different materials silently corrupts the command stream.

- **Flipped-Y ImGuizmo Gizmo Axes** — the Vulkan backend uses a negative-height viewport to flip Y (OpenGL convention), which stores the framebuffer flipped. ImGui compensates by swapping the UV coordinates on the texture quad. But ImGuizmo's screen-space math then disagrees with the camera projection matrix, causing the Y-axis gizmo to move entities in the wrong direction. The fix: multiply `projection[1][1] *= -1.0f` when passing to `ImGuizmo::Manipulate`.

Each of these warrants its own deep dive—and they will get one.

---

## Conclusion

The single-file flat vtable design isn't novel—it's what the Vulkan and WebGPU APIs themselves use internally, and it's how excellent open-source RHIs like `bgfx` and `sokol_gfx` operate. What it trades in extensibility via inheritance, it gains back in transparency, compile-time isolation, and zero-friction backend addition.

For a game engine where the rendering backend is not a plugin system but a compile-time choice, this is the right tradeoff. The architecture made adding WebGPU mechanical rather than architectural. That's the test of a good abstraction.
