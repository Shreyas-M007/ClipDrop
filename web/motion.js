const stage = document.getElementById("launch-stage");
const button = document.getElementById("motion-toggle");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let visible = false;
let paused = false;

function updateMotion() {
  if (!stage || !button) return;
  button.hidden = reduced.matches;
  button.toggleAttribute("data-paused", paused);
  document.documentElement.toggleAttribute("data-motion-paused", paused);
  const label = paused ? "Resume illustration animation" : "Pause illustration animation";
  button.setAttribute("aria-label", label);
  button.title = label;
  stage.toggleAttribute("data-running", !reduced.matches && !paused && visible && !document.hidden);
}

if (stage && button) {
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      updateMotion();
    }, { threshold: 0.08 });
    observer.observe(stage);
  } else {
    visible = true;
  }

  button.addEventListener("click", () => {
    paused = !paused;
    updateMotion();
  });
  reduced.addEventListener("change", updateMotion);
  document.addEventListener("visibilitychange", updateMotion);
  updateMotion();
}
