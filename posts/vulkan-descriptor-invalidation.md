# Descriptor Set Invalidation in Vulkan: The Hidden Rule About Mid-Loop Writes

This one cost me an afternoon. The geometry pass was working, the scene was rendering—and then I added a second mesh, and the validation layers fired a wall of errors while the GPU silently rendered garbage.

---

## Context: The Material Binding Model

Usul's deferred renderer has a geometry pass that iterates over every `MeshComponent` in the scene and draws it into the G-Buffer. Each mesh can have a unique `MaterialComponent` containing PBR textures (albedo, normal, metallic-roughness, AO) and scalar parameters.

The material data is uploaded to the GPU via:
- A per-frame, per-material `UniformBuffer` (`m_MaterialUBOs[frameIndex][materialIdx]`) holding the scalar values
- A per-frame, per-material `DescriptorSet` (`m_MaterialSets[frameIndex][materialIdx]`) binding those textures and the UBO

These are pre-allocated at init time—64 material slots per frame, enough for the expected scene complexity:

```cpp
for (uint32_t i = 0; i < k_MaxFrames; ++i)
{
    for (uint32_t j = 0; j < 64; ++j)
    {
        m_MaterialSets[i][j] = rhi::descriptor_set_create(m_MaterialLayout);
        m_MaterialUBOs[i][j] = rhi::buffer_create({ ... });
    }
}
```

The geometry pass loop looked like this:

```cpp
void SceneRenderer::GeometryPass(...)
{
    rhi::begin_render_pass(cmd, { /* 5 color targets + depth */ });
    rhi::bind_pipeline(cmd, m_GeometryPipeline);

    uint32_t materialIdx = 0;
    for (auto entity : meshView)
    {
        BindMaterial(cmd, *mat, 0, materialIdx);  // frameIndex hardcoded to 0
        rhi::push_constants_raw(cmd, rhi::ShaderStage::Vertex, 0, sizeof(pushConst), &pushConst);
        rhi::bind_vertex_buffer(cmd, mc.VertexBuffer, 0);
        rhi::bind_index_buffer(cmd, mc.IndexBuffer, 0, rhi::IndexType::Uint32);
        rhi::draw_indexed(cmd, { .index_count = mc.IndexCount });
        materialIdx++;
    }

    rhi::end_render_pass(cmd);
}
```

And `BindMaterial`:

```cpp
void SceneRenderer::BindMaterial(const rhi::CmdBuf& cmd,
                                  const MaterialComponent& mat,
                                  uint32_t frameIndex, uint32_t materialIdx)
{
    // Upload scalar data to UBO
    auto mapped = rhi::buffer_map(m_MaterialUBOs[frameIndex][materialIdx]);
    GPUMaterialUBO& ubo = *static_cast<GPUMaterialUBO*>(mapped.ptr);
    ubo.AlbedoColor = mat.AlbedoColor;
    ubo.Metallic    = mat.Metallic;
    // ...
    rhi::buffer_unmap(m_MaterialUBOs[frameIndex][materialIdx]);

    rhi::DescriptorSet set = m_MaterialSets[frameIndex][materialIdx];

    rhi::DescriptorWrite writes[5] = {
        {.binding=0, .type=rhi::DescriptorType::CombinedImageSampler, .texture={texAlbedo, m_LinearSampler}},
        {.binding=1, .type=rhi::DescriptorType::CombinedImageSampler, .texture={texNormal, m_LinearSampler}},
        {.binding=2, .type=rhi::DescriptorType::CombinedImageSampler, .texture={texMR,     m_LinearSampler}},
        {.binding=3, .type=rhi::DescriptorType::CombinedImageSampler, .texture={texAO,     m_LinearSampler}},
        {.binding=4, .type=rhi::DescriptorType::UniformBuffer,        .buffer={m_MaterialUBOs[frameIndex][materialIdx], 0, sizeof(GPUMaterialUBO)}},
    };

    rhi::descriptor_set_write(set, writes, 5);  // <-- write the descriptor set
    rhi::bind_descriptor_set(cmd, set, 0);      // <-- then bind it
}
```

With a single mesh this worked perfectly. Two meshes: validation errors. Three meshes: visual corruption.

---

## The Validation Error

```
Validation Error: [ VUID-vkCmdBindVertexBuffers-commandBuffer-recording ]
vkCmdBindVertexBuffers(): was called in VkCommandBuffer 0x... which is now in an
invalid state because VkDescriptorSet 0x... was destroyed or updated without
UPDATE_AFTER_BIND.
```

The error says the *command buffer is in an invalid state*—not that a specific resource is invalid. That's the clue.

---

## Dissecting the Root Cause

Here's what Vulkan actually requires. From the spec:

> The application **must not** call `vkUpdateDescriptorSets` to modify a descriptor set that is used in a command buffer that is in the recording state, unless the descriptor set was allocated with `VK_DESCRIPTOR_BINDING_UPDATE_AFTER_BIND_BIT`.

In other words: once you've called `vkCmdBindDescriptorSets` for a descriptor set in a command buffer that's currently being recorded, you cannot update that descriptor set again until the command buffer finishes execution—unless you've opted into `UPDATE_AFTER_BIND`.

Here's exactly what was happening per-frame:

1. `cmdbuf_begin(cmd)` — command buffer enters recording state
2. `begin_render_pass(cmd, ...)` — geometry pass begins
3. **Mesh 0**: `descriptor_set_write(m_MaterialSets[0][0], ...)` ← writes set 0
4. **Mesh 0**: `bind_descriptor_set(cmd, m_MaterialSets[0][0], 0)` ← records bind of set 0
5. **Mesh 0**: `draw_indexed(...)` ← records a draw referencing set 0
6. **Mesh 1**: `descriptor_set_write(m_MaterialSets[0][1], ...)` ← writes set 1
7. **Mesh 1**: `bind_descriptor_set(cmd, m_MaterialSets[0][1], 0)` ← records bind of set 1
8. **Mesh 1**: `draw_indexed(...)` ← records a draw referencing set 1

Wait—that looks fine. Each mesh uses a different slot index (`[0][0]` vs `[0][1]`). Where's the illegal update?

The bug was subtler. Notice the hardcoded `frameIndex = 0`:

```cpp
BindMaterial(cmd, *mat, 0, materialIdx);  // frameIndex hardcoded to 0
```

When frame N+1 arrived (same frame index 0), the geometry pass loop started again from `materialIdx = 0`. On the *second* frame, mesh 0 wrote `m_MaterialSets[0][0]`—the **same descriptor set** that was bound in a still-in-flight command buffer from frame N.

Because Usul's triple-buffering was using a per-frame fence that only waited on *this frame's* fence, frames N-1 and N-2 could still be executing. Their command buffers had already recorded `vkCmdBindDescriptorSets` with `m_MaterialSets[0][0]`. Calling `vkUpdateDescriptorSets` on that set while those command buffers are in flight is explicitly illegal.

---

## Why It Worked With One Mesh

With a single mesh, the workload completed fast enough that the per-frame fence always caught up—by the time frame N+1 arrived, frame N's GPU work had finished. The update was technically illegal but the timing made it harmless. With two meshes or heavier geometry, the GPU fell behind, and the hazard window opened.

This is a classic "works on my machine" timing-dependent bug. On a fast GPU it's invisible. On a slower GPU or a heavy scene it crashes immediately.

---

## The Solutions

There are three correct approaches:

### Option 1: Unique Descriptor Set Per Material (Chosen for Usul)

Pre-allocate one descriptor set per material slot, one per frame in flight. Write the descriptor set **once** at material creation or load time, not every frame inside the draw loop.

```cpp
// At init: 3 frames × 64 material slots = 192 descriptor sets
for (uint32_t i = 0; i < k_MaxFrames; ++i)
    for (uint32_t j = 0; j < 64; ++j)
        m_MaterialSets[i][j] = rhi::descriptor_set_create(m_MaterialLayout);

// At draw time: ONLY update the set for the current frameIndex, no longer
// update a set that belongs to a different frame's in-flight command buffer.
// The per-frame fence ensures frame i's sets are not in-flight when frame i
// is next scheduled.
```

The critical correction: bind based on `frameIndex` (the *actual* current frame slot, not hardcoded 0), and ensure the per-frame fence has been waited before writing to that frame's descriptor sets.

### Option 2: Dynamic Uniform Buffer Offsets

Instead of one UBO per material, use one large UBO with `UniformBufferDynamic`. Write all material data into contiguous regions of one buffer before the draw loop. Bind the same descriptor set once and pass a dynamic offset per draw call.

```cpp
// Bind once with dynamic offset capability
rhi::bind_descriptor_set(cmd, m_MaterialSet, 0,
                          &dynamicOffsets[materialIdx], 1);
```

No mid-loop descriptor set writes at all.

### Option 3: Bindless Rendering

Abandon per-draw descriptor sets entirely. Upload all material textures to a global array at load time. Pass a `materialIndex` via push constants. The shader indexes the array directly.

```glsl
// In shader: no per-draw descriptor binding needed
layout(set=0, binding=0) uniform sampler2D allTextures[];
// ...
vec4 albedo = texture(allTextures[push.materialIndex * 4 + 0], uv);
```

This is the approach used by modern engines (Frostbite, Nanite) and eliminates the problem entirely because there are no per-draw descriptor set writes.

---

## What the Validation Layer Was Really Saying

The error message was misleading at first glance. "Command buffer in invalid state" sounds like a command buffer bug. But the actual cause is a descriptor set update racing with an in-flight command buffer.

The VUID number `VUID-vkCmdBindVertexBuffers-commandBuffer-recording` is what the validation layer fires *as a consequence*—the command buffer is invalidated by the illegal descriptor update, and then the next command recorded into it (binding vertex buffers) triggers the report. The root error is the `vkUpdateDescriptorSets` call on the in-flight set; the error fires on the next command.

---

## The Rule

> Never call `vkUpdateDescriptorSets` on a descriptor set that has been recorded into a command buffer that is still executing on the GPU.

The per-frame fence on a command buffer protects *that command buffer's resources*. If multiple frames share the same descriptor set (because the frame index is hardcoded or reused incorrectly), the fence only protects one of them.

The fix is either strict indexing (descriptor sets are truly per-frame with no aliasing), dynamic offsets (no writes at draw time), or bindless (no per-draw descriptor sets at all).
