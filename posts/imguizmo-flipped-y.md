# The Flipped-Y Problem: Why ImGuizmo Moves Entities the Wrong Way

This one was a genuine head-scratcher. The scene was rendering correctly. The gizmo was drawing in the right place on screen. But drag the Y-axis handle upward, and the entity moved *down*. Rotate around the X-axis clockwise, and the entity rotated counter-clockwise. Every Y-related operation was inverted.

The bug lived at the intersection of three different coordinate systems that were all doing the right thing individually—and collectively producing the wrong answer.

---

## Background: Why Vulkan Needs Flipped Viewports

Vulkan's Normalized Device Coordinates (NDC) define +Y as pointing **down** in screen space. OpenGL (and by extension GLM, ImGui, and most tooling) defines +Y as pointing **up**. If you naively port an OpenGL renderer to Vulkan without compensating, your scene renders upside down.

The standard fix—and the one Usul uses—is to set a **negative height viewport** in the Vulkan command stream:

```cpp
// Inside vkrhi.cpp — vk_cmd_set_viewport
void vk_cmd_set_viewport(rhi::CmdBuf ch, const rhi::Viewport& vp)
{
    CmdBufSlot* s = s_cmdbufs.get_checked(ch);
    // Set origin at (x, y + height) with negative height — flips Y
    VkViewport viewport{
        .x        = vp.x,
        .y        = vp.y + vp.h,   // origin at bottom
        .width    = vp.w,
        .height   = -vp.h,          // negative height flips the Y axis
        .minDepth = vp.min_depth,
        .maxDepth = vp.max_depth,
    };
    vkCmdSetViewport(s->cmd, 0, 1, &viewport);
}
```

This trick—specified in the Vulkan spec as a legal viewport configuration—flips the Y axis at the rasterizer level. Vertex shader output stays in GLM convention (+Y up), and the viewport transform handles the inversion. No shader changes needed.

---

## The Display Problem: Upside-Down Framebuffer in ImGui

The viewport flip solves the rendering problem, but creates a display problem. The color attachment written by the geometry pass and lighting pass is stored flipped—its pixel (0, 0) corresponds to the visual bottom-left of the scene, not the top-left.

When ImGui displays this texture via `ImGui::Image()`, the default UV mapping (`{0,0}` to `{1,1}`) would show the scene upside down. The fix is to swap the V coordinates:

```cpp
// EditorLayer.cpp
rhi::Texture colorOut = m_SceneRenderer.GetColorOutput();
ImGui::Image(
    (ImTextureID)rhi::imgui_add_texture(colorOut),
    ImVec2{ m_ViewportSize.x, m_ViewportSize.y },
    ImVec2{ 0, 1 },   // uv0: bottom-left of texture = visual top-left
    ImVec2{ 1, 0 }    // uv1: top-right of texture   = visual bottom-right
);
```

Now the scene looks correct in the editor viewport. The UV flip is the visual compensation for the GPU-side viewport flip.

---

## Enter ImGuizmo

ImGuizmo is a header-only gizmo library layered on top of ImGui. It draws translate/rotate/scale handles over a 3D scene by projecting 3D world-space positions into the 2D screen space of the current ImGui window.

To do this correctly, it needs:
- The camera's **view matrix** (world → camera)
- The camera's **projection matrix** (camera → clip space)
- The entity's **world transform matrix**

The initial integration was straightforward:

```cpp
// First attempt — naive
glm::mat4 cameraProjection = m_EditorCamera.GetProjectionMatrix();
glm::mat4 cameraView       = m_EditorCamera.GetViewMatrix();

ImGuizmo::Manipulate(
    glm::value_ptr(cameraView),
    glm::value_ptr(cameraProjection),
    (ImGuizmo::OPERATION)m_GizmoType, ImGuizmo::LOCAL,
    glm::value_ptr(transform),
    nullptr, snap ? snapValues : nullptr
);
```

The gizmo appeared in the correct position on screen. But dragging the Y handle moved the entity in -Y. Rotate up moved down. Scale was fine (it has no direction).

---

## Debugging: Logging the Matrices

The first hypothesis was that the view or projection matrix was wrong. The camera had been tested independently and rendered the scene correctly, so view was ruled out quickly.

A temporary logging pass printed the projection matrix to disk every frame:

```cpp
// Temporary debug in GeometryPass
glm::mat4 proj = camera.GetProjectionMatrix();
{
    static int count = 0;
    if (count < 2) {
        std::ofstream logFile("/Users/sujay/CLionProjects/Usul/matrix_log.txt", std::ios::app);
        logFile << "Projection matrix:\n";
        for (int i = 0; i < 4; ++i) {
            for (int j = 0; j < 4; ++j)
                logFile << proj[i][j] << " ";
            logFile << "\n";
        }
        count++;
    }
}
```

The logged projection matrix looked correct for a GLM perspective projection (positive `[1][1]`). The geometry rendered right-side up in the viewport (because the UV flip compensated). Everything was internally consistent.

---

## The Realization: Two Different Screen Spaces

The bug clicked into place after looking at what ImGuizmo actually does with the projection matrix.

ImGuizmo takes the projection matrix and uses it to project 3D points into **2D screen pixels**—specifically into the coordinate system of the ImGui window. The ImGui window uses a top-left origin with +Y pointing down (standard screen-space convention for UI systems).

Here's the chain:

1. **GPU rendering**: Vulkan viewport with negative height → Y flipped at rasterizer → framebuffer stored with Y inverted
2. **ImGui display**: UV flip on the texture quad (`{0,1}` to `{1,0}`) → visual result appears correct
3. **ImGuizmo math**: Uses the projection matrix to project into the ImGui window's screen space → assumes ImGui window +Y is down (it is) → but the camera projection's +Y is *up*

The projection matrix has `[1][1] = (2 * near) / (top - bottom)`, which is positive for a standard perspective projection. In a standard OpenGL framebuffer, positive `[1][1]` means +Y in clip space maps to +Y on screen (up). In the ImGui window, +Y on screen is **down**.

So when ImGuizmo projects a point slightly above the entity into the ImGui window:
- The projection says: Y clip coordinate is positive → screen Y should be negative (going up)
- The ImGui window says: Y going up means decreasing pixel Y → that's visual *up*, which in the ImGui convention is toward the top of the window

But because the *framebuffer* was already flipped and then corrected by the UV flip, what appears visually as "up" in the editor window corresponds to *decreasing* framebuffer Y—which, after the double-flip, maps to *positive* clip Y.

ImGuizmo's projection math produced the right *position* for the gizmo (it looks correct), but its *drag direction* interpretation was inverted on Y. When you drag upward in screen pixels, ImGuizmo interprets that as decreasing screen Y, converts through the projection, and computes a negative world-space Y delta.

---

## The Fix: Flip the Projection Y-Scale for ImGuizmo

The fix is to pass ImGuizmo a projection matrix that has its Y scale negated—making the projection's Y convention match the actual screen-space Y convention that ImGuizmo uses:

```cpp
// EditorLayer.cpp — the corrected gizmo code
glm::mat4 cameraProjection = m_EditorCamera.GetProjectionMatrix();
cameraProjection[1][1] *= -1.0f;  // Align projection Y with ImGui screen-space Y
glm::mat4 cameraView = m_EditorCamera.GetViewMatrix();

ImGuizmo::Manipulate(
    glm::value_ptr(cameraView),
    glm::value_ptr(cameraProjection),  // now Y-flipped for ImGuizmo
    (ImGuizmo::OPERATION)m_GizmoType, ImGuizmo::LOCAL,
    glm::value_ptr(transform),
    nullptr, snap ? snapValues : nullptr
);
```

This projection matrix is **not** passed to the GPU. It's only used for ImGuizmo's internal 2D screen-space math. The GPU continues to use the unmodified projection matrix, which the Vulkan viewport flip handles correctly.

After this change:
- Drag Y-axis up → entity moves up ✓
- Rotate around X clockwise → entity rotates clockwise ✓  
- Translate on X and Z → unchanged and correct ✓

---

## Why the Gizmo Position Was Still Correct

One thing that confused me initially: if Y was inverted, why did the gizmo appear in the right place? Shouldn't it be drawn at a mirrored Y position?

The answer is that ImGuizmo uses the projection matrix both for computing the gizmo's screen position and for interpreting the drag delta. The position computation uses the full matrix, so the Y inversion cancels out—the projected position is the same whether `[1][1]` is positive or negative (the negation just changes the sign of a product that's then compared to another signed quantity). The drag delta computation is what breaks, because it converts a screen-space delta (unsigned, directional) through the projection, and there the sign of `[1][1]` directly affects the result's direction.

---

## The Lesson: There Are Three Coordinate Systems Here

| System | +Y Direction | Notes |
|--------|-------------|-------|
| GLM world space / camera projection | Up | Standard math convention |
| Vulkan NDC / rasterizer (negative height viewport) | Compensated to Up | The viewport flip makes GLM matrices work correctly |
| ImGui window screen space | Down | Standard screen/UI convention |
| GPU framebuffer texture | Down (flipped) | Result of the Vulkan viewport flip |
| ImGui texture display (UV-flipped) | Up visually | The UV swap compensates for the framebuffer flip |

ImGuizmo lives in system 3 (ImGui screen space) and receives data from system 1 (camera projection). Those two disagree on Y direction by exactly a sign flip. The single-line fix re-signs the projection to match ImGuizmo's expected convention.

The takeaway: when layering multiple coordinate systems—GPU rendering, immediate-mode UI, and screen-space overlays—always trace which system each tool operates in before debugging its behavior.
