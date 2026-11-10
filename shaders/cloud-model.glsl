// Adapted from src/ui/CloudModel.h; preserve density, erosion, and self-shadowing.
// Website lighting uses brighter cyan/violet tints. GLSL ES forbids C++ float suffixes.
// Shared by the C++ reference, Metal, and GLSL. CLOUD_VOLUME and cloudNoise
// supply backend-specific filtered sampling of the same periodic 3D texture.
struct CloudFlow
{
    float3 shape, warp, detail, wisps;
};

CloudFlow cloudFlow(float seconds)
{
    float angle = seconds * (6.28318530718 / 480.0);
    CloudFlow flow;
    // Independent motion through the volume changes projected silhouettes and
    // erosion; moving a baked image cannot reveal or dissolve cloud structure.
    flow.shape = float3(0.045 * sin(angle), 0.025 * sin(angle * 2.0), 0.16 * sin(angle));
    flow.warp = float3(0.12 * sin(angle * 2.0), 0.10 * (cos(angle) - 1.0), 0.13 * sin(angle * 3.0));
    flow.detail = float3(-0.13 * sin(angle * 2.0), 0.19 * sin(angle), 0.18 * (cos(angle * 2.0) - 1.0));
    flow.wisps = float3(0.20 * sin(angle * 3.0), -0.16 * sin(angle * 2.0), 0.25 * sin(angle));
    return flow;
}

float cloudDensity(CLOUD_VOLUME volume, float3 p, CloudFlow flow)
{
    float3 warp = cloudNoise(volume, p * 0.47 + float3(0.13, 0.29, 0.51) + flow.warp);
    p = p + (warp + float3(-0.5)) * 0.32;
    float3 shape = cloudNoise(volume, p + flow.shape);
    float3 detail = cloudNoise(volume, p * 2.17 + float3(0.19, 0.37, 0.11) + flow.detail);
    float3 wisps = cloudNoise(volume, p * 5.13 + float3(0.71, 0.07, 0.31) + flow.wisps);
    float body = max(0.0, (shape.x - 0.35) * 5.4);
    float density = max(0.0, body - (1.0 - detail.y) * 0.60 - (1.0 - wisps.z) * 0.30);
    return density * smoothstep(0.0, 0.24, density);
}

struct CloudSample
{
    float3 light;
    float transmission;
};

// Catmull-Rom reconstruction retains detail between quarter-resolution rays.
float cloudCubicWeight(float distance)
{
    float x = abs(distance);
    if (x <= 1.0)
        return (1.5 * x - 2.5) * x * x + 1.0;
    if (x < 2.0)
        return ((-0.5 * x + 2.5) * x - 4.0) * x + 2.0;
    return 0.0;
}

CloudSample cloudRay(CLOUD_VOLUME volume, float x, float y, float seconds, float cameraDistance, vec2 cloudOffset)
{
    CloudFlow flow = cloudFlow(seconds);
    CloudSample result;
    result.light = float3(0.0);
    result.transmission = 1.0;
    for (int step = 0; step < 24; ++step)
    {
        float z = (float(step) + 0.5) / 24.0;
        // Near and far banks occupy independent parts of the noise volume;
        // their different projected scales preserve overlapping silhouettes.
        float scale = mix(0.95, 1.50, z);
        // A receding camera widens the view, with more parallax in the near bank.
        float perspective = 1.0 + cameraDistance * mix(0.90, 0.35, z);
        float viewX = (x - 0.5) * perspective + 0.5;
        float viewY = (y - 0.5) * perspective + 0.5;
        float3 p = float3(viewX * scale + z * 0.40, viewY * scale - z * 0.19,
                          z * 1.25 - cameraDistance * 0.45);
        // Advect the whole domain so shape, erosion, colour, and shadows travel together.
        p.xy += cloudOffset;
        float centre = mix(0.42, 0.54, z);
        float band = exp(-((viewY - centre) * (viewY - centre)) / 0.060);
        float nearBank = exp(-((z - 0.22) * (z - 0.22)) / 0.015);
        float farBank = exp(-((z - 0.72) * (z - 0.72)) / 0.045);
        float density = cloudDensity(volume, p, flow) * band * (nearBank + farBank * 0.65) * 2.8;
        if (density < 0.015)
            continue;
        // A short light march approximates self-shadowing; the powder term
        // brightens folds without making the entire cloud uniformly emissive.
        float shadow = cloudDensity(volume, p + float3(-0.07, -0.04, -0.08), flow);
        shadow += cloudDensity(volume, p + float3(-0.18, -0.10, -0.20), flow);
        float lighting = 0.10 + 1.3 * exp(-shadow * 2.4) * (1.0 - exp(-density * 2.0));
        // Color belongs to the volume, so nearer violet/cyan folds can veil
        // independently colored blue haze along the same viewing ray.
        float colourField = cloudNoise(volume, p * 0.63 + float3(0.41, 0.17, 0.73) + flow.shape).x;
        float colourMix = smoothstep(0.32, 0.66, colourField + (x - 0.5) * 0.18);
        float3 nearTint = mix(float3(0.008, 0.28, 0.48), float3(0.46, 0.012, 0.72), colourMix);
        float3 farTint = mix(float3(0.006, 0.024, 0.32), float3(0.10, 0.010, 0.40), colourMix);
        float3 tint = mix(nearTint, farTint, smoothstep(0.28, 0.70, z));
        float alpha = 1.0 - exp(-density * (5.0 / 24.0));
        result.light = result.light + tint * (result.transmission * alpha * lighting);
        result.transmission *= 1.0 - alpha;
        if (result.transmission < 0.015)
            break;
    }
    return result;
}

float cloudHash(float x, float y)
{
    // Integer-valued float arithmetic keeps CPU/GPU star positions identical.
    float a = fmod(x * 73.0 + y * 239.0 + 19.0, 1021.0);
    return fmod(a * a * 13.0 + a * 17.0, 1021.0) / 1021.0;
}

float cloudDisplay(float value)
{
    return value <= 0.0031308 ? value * 12.92 : 1.055 * pow(value, 1.0 / 2.4) - 0.055;
}

float cloudFold(float x, float width)
{
    float period = width * 2.0;
    float wrapped = x - floor(x / period) * period;
    return width - abs(width - wrapped);
}

float cloudStar(float x, float y, float spacing, float offset, float radius, float brightness)
{
    float cellX = floor(x / spacing), cellY = floor(y / spacing);
    float seed = cloudHash(cellX + offset, cellY + offset);
    if (seed <= 0.94)
        return 0.0;
    float dx = x - (cellX * spacing + 3.0 + (spacing - 6.0) * cloudHash(cellX + offset + 17.0, cellY));
    float dy = y - (cellY * spacing + 3.0 + (spacing - 6.0) * cloudHash(cellX, cellY + offset + 29.0));
    float size = radius + (seed - 0.94) * 5.0;
    return exp(-(dx * dx + dy * dy) / (size * size)) * (brightness + (seed - 0.94) * 3.0);
}

float cloudGridNoise(float cellX, float cellY, float blendX, float blendY, float seed)
{
    cellX += seed * 17.0;
    cellY += seed * 31.0;
    return mix(mix(cloudHash(cellX, cellY), cloudHash(cellX + 1.0, cellY), blendX),
               mix(cloudHash(cellX, cellY + 1.0), cloudHash(cellX + 1.0, cellY + 1.0), blendX), blendY);
}

float3 cloudDecorate(float3 light, float transmission, float x, float y, float width, float height, float screenX,
                     float farOffset, float gridSeed, float gridBlend)
{
    float nx = x / width, ny = y / height;
    float quiet = smoothstep(0.04, 0.18, ny) * (1.0 - smoothstep(0.80, 0.98, ny));
    float3 base = float3(0.00335, 0.0056, 0.0116);
    float3 rgb = base + light * (quiet * 0.72);
    rgb = float3(cloudDisplay(rgb.x), cloudDisplay(rgb.y), cloudDisplay(rgb.z));
    float lineX = max(0.0, 1.0 - abs(fmod(x + 12.0, 24.0) - 12.0));
    float lineY = max(0.0, 1.0 - abs(fmod(y + 12.0, 24.0) - 12.0));
    float grid = max(lineX, lineY) * quiet * 0.035;
    if (grid > 0.0)
    {
        float patchX = nx * 9.0 + 17.0, patchY = ny * 6.0 + 31.0;
        float cellX = floor(patchX), cellY = floor(patchY);
        float blendX = smoothstep(0.0, 1.0, patchX - cellX);
        float blendY = smoothstep(0.0, 1.0, patchY - cellY);
        // Morph density before thresholding, so patches grow and dissolve.
        float densityPatch = mix(cloudGridNoise(cellX, cellY, blendX, blendY, gridSeed),
                          cloudGridNoise(cellX, cellY, blendX, blendY, fmod(gridSeed + 1.0, 1021.0)), gridBlend);
        grid *= smoothstep(0.60, 0.85, densityPatch);
    }
    // Far, cloud-depth, and foreground stars pan at 6%, 18%, and 36%.
    // Separate seeds, spacing, and point sizes keep the planes visually distinct.
    float farStars = cloudStar(cloudFold(screenX + farOffset, width), y, 23.0, 113.0, 0.45, 0.12);
    float stars = cloudStar(x, y, 29.0, 0.0, 0.6, 0.18);
    float nearStars = cloudStar(cloudFold(screenX + farOffset * 6.0, width), y, 47.0, 271.0, 0.9, 0.24);
    return rgb + float3(grid + quiet * ((farStars + stars) * (0.25 + 0.75 * transmission) + nearStars));
}

