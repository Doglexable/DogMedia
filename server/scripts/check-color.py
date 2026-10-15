#!/usr/bin/env python3
"""Extract object colors from artwork, ignoring edge-connected black/white areas."""

import argparse
from collections import Counter, deque
import json
from pathlib import Path
import random

from PIL import Image, UnidentifiedImageError


ALGORITHM_VERSION = 1
MAX_EDGE = 256
MAX_SAMPLE = 12000


def is_background(pixel, tolerance, kind):
    red, green, blue, alpha = pixel
    if alpha < 16:
        return False
    if kind == "white":
        return min(red, green, blue) >= 255 - tolerance
    return max(red, green, blue) <= tolerance


def object_pixels(image, tolerance):
    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = list(rgba.get_flattened_data())
    excluded = bytearray(width * height)

    # Flood-fill each color separately, matching the original script's
    # edge-connected white/black masks and 8-neighbor connectivity.
    for kind in ("white", "black"):
        queue = deque()
        for x in range(width):
            queue.extend((x, (height - 1) * width + x))
        for y in range(height):
            queue.extend((y * width, y * width + width - 1))
        visited = bytearray(width * height)
        while queue:
            index = queue.popleft()
            if visited[index]:
                continue
            visited[index] = 1
            if not is_background(pixels[index], tolerance, kind):
                continue
            excluded[index] = 1
            x, y = index % width, index // width
            for next_y in range(max(0, y - 1), min(height, y + 2)):
                for next_x in range(max(0, x - 1), min(width, x + 2)):
                    neighbor = next_y * width + next_x
                    if not visited[neighbor]:
                        queue.append(neighbor)

    return [pixel[:3] for index, pixel in enumerate(pixels)
            if not excluded[index] and pixel[3] >= 16]


def distance_squared(left, right):
    return sum((left[channel] - right[channel]) ** 2 for channel in range(3))


def dominant_colors(pixels, count):
    if not pixels:
        return []
    rng = random.Random(42)
    sample = rng.sample(pixels, min(MAX_SAMPLE, len(pixels)))
    frequencies = Counter(sample)
    distinct = list(frequencies)
    count = min(count, len(distinct))
    centers = [tuple(map(float, rng.choice(sample)))]

    # Frequency-weighted k-means++ initialization keeps the result stable.
    while len(centers) < count:
        weights = [frequencies[color] * min(distance_squared(color, center) for center in centers)
                   for color in distinct]
        if not any(weights):
            break
        centers.append(tuple(map(float, rng.choices(distinct, weights=weights, k=1)[0])))

    for _ in range(15):
        sums = [[0, 0, 0] for _ in centers]
        sizes = [0] * len(centers)
        for color, frequency in frequencies.items():
            nearest = min(range(len(centers)), key=lambda index: distance_squared(color, centers[index]))
            sizes[nearest] += frequency
            for channel in range(3):
                sums[nearest][channel] += color[channel] * frequency
        updated = [tuple(sums[index][channel] / sizes[index] for channel in range(3))
                   if sizes[index] else centers[index] for index in range(len(centers))]
        if all(distance_squared(old, new) < 0.25 for old, new in zip(centers, updated)):
            centers = updated
            break
        centers = updated

    counts = [0] * len(centers)
    for color, frequency in Counter(pixels).items():
        nearest = min(range(len(centers)), key=lambda index: distance_squared(color, centers[index]))
        counts[nearest] += frequency
    return [
        {
            "hex": "#{:02x}{:02x}{:02x}".format(*(round(channel) for channel in centers[index])),
            "percentage": round(counts[index] * 100 / len(pixels), 2),
        }
        for index in sorted(range(len(centers)), key=lambda index: counts[index], reverse=True)
        if counts[index]
    ]


def analyze(path, count=5, tolerance=20):
    with Image.open(path) as image:
        pixels = object_pixels(image, tolerance)
    if not pixels:
        raise ValueError("No object pixels remain after background removal")
    return {
        "algorithm_version": ALGORITHM_VERSION,
        "background_ignored": True,
        "colors": dominant_colors(pixels, count),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path, help="Artwork file path (JPEG, PNG, WebP, etc.)")
    parser.add_argument("--colors", type=int, default=5, help="Number of colors (default: 5)")
    parser.add_argument("--tolerance", type=int, default=20, help="White/black threshold (default: 20)")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    args = parser.parse_args()
    if not 1 <= args.colors <= 10 or not 0 <= args.tolerance <= 127:
        parser.error("--colors must be 1..10 and --tolerance must be 0..127")
    try:
        result = analyze(args.image, args.colors, args.tolerance)
    except (OSError, UnidentifiedImageError, ValueError) as error:
        parser.exit(1, f"Could not analyze {args.image}: {error}\n")
    if args.json:
        print(json.dumps(result, separators=(",", ":")))
    else:
        print("=== WARNA DOMINAN OBJEK (BACKGROUND DIABAIKAN) ===")
        for color in result["colors"]:
            print(f"Hex: {color['hex']} | Porsi: {color['percentage']:.2f}%")


if __name__ == "__main__":
    main()
