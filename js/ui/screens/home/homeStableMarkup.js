export function setHomeHtmlIfChanged(node, markup) {
  if (!node || node.innerHTML === markup) return false;
  node.innerHTML = markup;
  return true;
}
