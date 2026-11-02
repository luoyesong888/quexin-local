# 鹊巢场景资源提示词

生成方式：内置 `image_gen` 工具。生成日期：2026-10-27。

用途：宠物展示背景；独立鸟角色由前端叠加。三张图均使用横向约 16:9 构图，中央偏右和下半部留出落脚平台，无人物、动物、文字或 UI。

## room-study.png

```text
Use case: stylized-concept. Asset type: polished widescreen 16:9 background environment for a cozy virtual pet habitat in an elegant Chinese relationship journal application. Render ONE environment only, full-bleed landscape, no interface. Scene: a refined warm Chinese study, cream plaster and pale honey oak, a large wooden lattice window looking onto softly layered distant mountains, a few tasteful potted plants and a small stack of blank cloth-bound books at the far left. Composition: eye-level slightly downward camera, spacious and uncluttered; the lower half and center-right contain a broad EMPTY clean wooden desk platform, suitable for compositing a separate small bird character afterwards. The empty tabletop is the visual focus at x 65%, y 75%; nothing occupies this landing zone. Background room details frame the outer edges only. Style: premium cozy game environment, soft painterly 3D illustration, crafted material textures, gentle depth of field, sophisticated and calm rather than cartoonish. Lighting: clear warm afternoon sunlight from the left window, creamy highlights, delicate natural shadows. Palette: ivory, light wood, muted sage, a small touch of warm brass. Constraints: NO birds, NO animals, NO people, NO creatures, NO characters, NO text or lettering, NO calligraphy, NO signs, NO UI, NO borders, NO watermark. Do not place objects in the central-right empty platform. Wide 16:9 composition.
```

来源：/Users/luoyesong/.codex/generated_images/01a17935-991f-7ef2-8531-9a2c5783b0fa/exec-b98e772a-bf33-4c1e-af92-b1387cadd806.png

## room-garden.png

```text
Use case: stylized-concept. Asset type: polished widescreen 16:9 background environment for a cozy virtual pet habitat in an elegant Chinese relationship journal application. Render ONE environment only, full-bleed landscape, no interface. Scene: a refined miniature bamboo water garden viewed from a covered Chinese pavilion, slender bamboo and pale jade foliage framing the left and outer edges, a shallow reflective pond beyond, a few rounded landscape stones, softly receding garden architecture. Composition: eye-level slightly downward camera, spacious and uncluttered; the lower half and center-right contain a broad EMPTY pale wood and smooth warm stone platform, suitable for compositing a separate small bird character afterwards. The empty landing platform is the visual focus at x 65%, y 75%; nothing occupies this landing zone. Keep bamboo and plants behind the platform and on image edges. Style: premium cozy game environment, delicate painterly 3D illustration, natural crafted textures, sophisticated Chinese garden aesthetic, soft atmospheric depth. Lighting: clear luminous morning sunlight through bamboo, pale translucent jade tones, subtle dappled shadows kept away from the center landing spot. Palette: light jade, pale moss green, ivory, weathered light wood. Constraints: NO birds, NO animals, NO people, NO creatures, NO characters, NO text or lettering, NO calligraphy, NO signs, NO UI, NO borders, NO watermark. No object on the center-right platform. Wide 16:9 composition.
```

来源：/Users/luoyesong/.codex/generated_images/01a17935-991f-7ef2-8531-9a2c5783b0fa/exec-6dd1d304-d97a-4e5a-9fee-79f5dcaab4e2.png

## room-cosmos.png

```text
Use case: stylized-concept. Asset type: polished widescreen 16:9 background environment for a cozy virtual pet habitat in an elegant relationship journal application. Render ONE environment only, full-bleed landscape, no interface. Scene: an intimate futuristic astronomy study floating among stars, deep ocean blue architectural interior, a generous curved panoramic window with soft moonlight, a crescent moon and delicate distant starfields, subtle abstract constellations without labels. A few elegant small shelves are limited to the far left edge. Composition: eye-level slightly downward camera, spacious and uncluttered; lower half and center-right contain a broad EMPTY circular landing platform inset into the floor, with a thin restrained cyan luminous ring and soft matte dark blue surface, suitable for compositing a separate small bird character afterwards. The empty round platform is the visual focus at x 65%, y 75%; nothing occupies this landing zone. Style: premium cozy game environment, soft painterly 3D concept art, sophisticated calm sci-fi interior, tactile materials, atmospheric depth, quiet sense of wonder. Lighting: cool blue moonlight and elegant cyan accents, readable rich navy shadows, restrained glow. Palette: midnight ocean blue, muted teal, cyan light, touches of moon silver. Constraints: NO birds, NO animals, NO people, NO creatures, NO characters, NO text or lettering, NO numerals, NO signs, NO holographic UI, NO borders, NO watermark. No object on the center-right platform. Wide 16:9 composition.
```

来源：/Users/luoyesong/.codex/generated_images/01a17935-991f-7ef2-8531-9a2c5783b0fa/exec-5f9c3d05-23ea-41cb-933f-8748653da30d.png


## 宠物四姿态图集

- 文件：`public/assets/pet-sprites.png`
- 生成方式：内置 image_gen，基于用户最后提供的宠物动作参考图，透明背景。
- 布局：2×2，左上待机、右上开心互动、左下进食、右下休息。浏览器用 CSS background-position 显示各姿态。
- 提示词：Preserve the supplied reference character identity: a small crested songbird with golden tan and cream feathers, slate blue layered wings edged in gold, large dark brown eyes, long pointy tail, tiny red cord and seal charm at the ankle. Produce four equal cells on a transparent square canvas, with complete birds at equal scale and padding: standing right-facing three-quarter idle; happy gently spread wings; leaning forward eating from a cream ceramic bowl; sleeping eyes closed on a short branch. Detailed warm painterly illustration. No text, backgrounds or grid lines. Not a black and white magpie.
