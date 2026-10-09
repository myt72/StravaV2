# Bike photos

Photos added through the bike gallery modal are stored by the server in `public/images/bikes/<gearId>/` (gitignored).
The server stores only jpeg, png, webp and gif files (max 15 MB each).

## HEIC / HEIF

Browsers can't display HEIC, so `.heic` / `.heif` files are converted to JPEG **in the browser** before upload
(add, drag-and-drop and replace). The photo is slightly re-encoded (quality 0.9) and takes a second or two each.
The converter is loaded lazily, only the first time a HEIC/HEIF file is selected.

- Library: [heic2any](https://github.com/alexcorvi/heic2any) 0.0.4, vendored at `public/vendor/heic2any.min.js` (no CDN).
- License: MIT, see `public/vendor/LICENSE-heic2any.txt`.

Tip: on iPhone you can instead set Settings → Camera → Formats → Most Compatible to get JPEGs directly.
