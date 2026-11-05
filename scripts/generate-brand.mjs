import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// SVG paths are the source of truth. Run `npm run brand:generate` after edits.
const root = new URL("../", import.meta.url);
const asset = (path) => fileURLToPath(new URL(path, root));
const mark = await readFile(asset("public/brand/mark.svg"), "utf8");
const paths = mark
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "");
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80" fill="none">
  <rect width="80" height="80" rx="16" fill="#f7f6f2"/>
  <g transform="translate(8 8)">${paths}</g>
</svg>
`;
await mkdir(asset("public/brand"), { recursive: true });
await writeFile(asset("src/app/icon.svg"), icon);
for (const size of [32, 192, 512]) {
  await sharp(Buffer.from(icon))
    .resize(size, size)
    .png()
    .toFile(asset(`public/brand/icon-${size}.png`));
}
await sharp(Buffer.from(icon))
  .resize(180, 180)
  .png()
  .toFile(asset("src/app/apple-icon.png"));
await sharp(Buffer.from(mark))
  .resize(512, 512)
  .png()
  .toFile(asset("public/brand/mark.png"));
await sharp(asset("public/brand/logo.svg"))
  .resize(1200)
  .png()
  .toFile(asset("public/brand/logo.png"));

// A native ICO directory containing PNG frames, with explicit 16–256px sizes.
const sizes = [16, 32, 48, 64, 128, 256];
const frames = await Promise.all(
  sizes.map((size) =>
    sharp(Buffer.from(icon)).resize(size, size).png().toBuffer(),
  ),
);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [index, frame] of frames.entries()) {
  const entry = 6 + index * 16;
  header[entry] = sizes[index] % 256;
  header[entry + 1] = sizes[index] % 256;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
}
await writeFile(
  asset("src/app/favicon.ico"),
  Buffer.concat([header, ...frames]),
);
console.log("Generated SVG, PNG, Apple touch icon, and six-size ICO assets.");
