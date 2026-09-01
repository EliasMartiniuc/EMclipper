from PIL import Image
import os

input_path = r"c:\Users\Elias\Documents\AI CLIPPER\frontend\public\logo.png"
output_path_webp = r"c:\Users\Elias\Documents\AI CLIPPER\frontend\public\logo.webp"

# Google PageSpeed Insights specifically requested 64x64 for mobile
img = Image.open(input_path)
img = img.resize((64, 64), Image.Resampling.LANCZOS)
img.save(output_path_webp, 'WEBP', quality=85)

print(f"Ultra-compressed logo to 64x64 WebP: {os.path.getsize(output_path_webp)} bytes")
