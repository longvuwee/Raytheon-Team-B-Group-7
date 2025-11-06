export default function makeSquareIcon(size = 16, fill = "rgba(255,140,0,0.9)", stroke = "rgba(0,0,0,0.6)") {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = fill; ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, size * 0.1);
  ctx.strokeRect(0, 0, size, size);
  return c.toDataURL("image/png");
}