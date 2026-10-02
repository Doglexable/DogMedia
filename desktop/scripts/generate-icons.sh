#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
desktop_dir=$(cd -- "$script_dir/.." && pwd)
repo_dir=$(cd -- "$desktop_dir/.." && pwd)

source_master="$repo_dir/web/public/web-app-manifest-512x512.png"

if [[ ! -f "$source_master" ]]; then
  echo "error: source web icon not found at $source_master" >&2
  exit 1
fi

ffmpeg_bin=$(command -v ffmpeg || true)
if [[ -z "$ffmpeg_bin" ]]; then
  echo "error: system ffmpeg is required to generate desktop icon assets" >&2
  exit 1
fi

echo "Using system ffmpeg: $ffmpeg_bin ($($ffmpeg_bin -version | head -n 1))"

# 1. Standard Linux hicolor theme PNG icons
for size in 16 24 32 48 64 128 256 512; do
  target_dir="$desktop_dir/resources/icons/hicolor/${size}x${size}/apps"
  mkdir -p "$target_dir"
  target_file="$target_dir/com.dogmedia.Desktop.png"
  echo "Generating ${size}x${size} icon -> $target_file"
  "$ffmpeg_bin" -y -v error \
    -i "$source_master" \
    -vf "scale=${size}:${size}:flags=lanczos" \
    -frames:v 1 -update 1 \
    "$target_file"
done

# 2. Master standalone PNG
mkdir -p "$desktop_dir/resources/icons"
echo "Generating master 512x512 icon -> $desktop_dir/resources/icons/com.dogmedia.Desktop.png"
"$ffmpeg_bin" -y -v error \
  -i "$source_master" \
  -vf "scale=512:512" \
  -frames:v 1 -update 1 \
  "$desktop_dir/resources/icons/com.dogmedia.Desktop.png"

# 3. Multi-resolution / Windows ICO
echo "Generating ICO -> $desktop_dir/resources/icons/com.dogmedia.Desktop.ico"
"$ffmpeg_bin" -y -v error \
  -i "$source_master" \
  -vf "scale=256:256" \
  -frames:v 1 -update 1 \
  "$desktop_dir/resources/icons/com.dogmedia.Desktop.ico"

# 4. In-app native UI brand mark
mkdir -p "$desktop_dir/assets"
echo "Generating in-app brand mark -> $desktop_dir/assets/brand-mark.png"
"$ffmpeg_bin" -y -v error \
  -i "$source_master" \
  -vf "scale=192:192:flags=lanczos" \
  -frames:v 1 -update 1 \
  "$desktop_dir/assets/brand-mark.png"

# 5. Scalable SVG wrapping the web master brand icon
svg_target="$desktop_dir/resources/icons/com.dogmedia.Desktop.svg"
echo "Generating scalable SVG -> $svg_target"
b64_data=$(base64 -w 0 "$desktop_dir/resources/icons/com.dogmedia.Desktop.png")
cat > "$svg_target" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="512" height="512" viewBox="0 0 512 512">
  <image width="512" height="512" href="data:image/png;base64,${b64_data}" xlink:href="data:image/png;base64,${b64_data}"/>
</svg>
EOF

# 6. Verify SVG decoding via system ffmpeg
echo "Verifying SVG icon with system ffmpeg..."
"$ffmpeg_bin" -y -v error \
  -i "$svg_target" \
  -frames:v 1 -update 1 \
  /tmp/pfs_verify_icon.png
rm -f /tmp/pfs_verify_icon.png

echo "All desktop icon assets generated and verified successfully."
