import { useEffect, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export function useTapeMotion(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    gsap.registerPlugin(ScrollTrigger);
    const prefersReduced = matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
    const select = <T extends HTMLElement = HTMLElement>(query: string) => root.querySelector<T>(query);
    const selectAll = (query: string) => Array.from(root.querySelectorAll<HTMLElement>(query));
    const toggle = select<HTMLButtonElement>("#motion-toggle");
    const loader = select("[data-preloader]");
    const hero = select(".launch-hero");
    const track = select(".story-track");
    const firstSeam = select(".story-seam");
    const footer = select(".story-footer");
    const workflow = select(".workflow-scene");
    const roomSection = select("#story-rooms");
    const productsSection = select(".content-types");
    const marquee = select("[data-marquee]");
    if (!toggle || !hero || !track || !firstSeam || !footer || !workflow || !roomSection || !productsSection || !marquee) return;

    const context = gsap.context(() => {}, root);
    let paused = false;
    let hasEntered = Boolean(location.hash || window.scrollY > 16);
    let pointerEvents: AbortController | undefined;
    let resizeFrame = 0;
    let finishIntro: (() => void) | undefined;

    const queueRefresh = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!paused && !prefersReduced.matches && root.getClientRects().length) ScrollTrigger.refresh();
      });
    };

    const configure = () => {
      pointerEvents?.abort();
      pointerEvents = undefined;
      finishIntro = undefined;
      context.revert();
      if (loader) loader.hidden = true;

      const reduced = prefersReduced.matches;
      const label = paused ? "Resume landing animations" : "Pause landing animations";
      toggle.hidden = reduced;
      toggle.toggleAttribute("data-paused", paused);
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
      root.dataset.motion = reduced ? "reduced" : paused ? "paused" : "on";
      if (paused) return;

      context.add(() => {
        if (reduced) {
          hasEntered = true;
          const fadeSections = new IntersectionObserver(entries => {
            entries.forEach(({ isIntersecting, target }) => {
              if (!isIntersecting) return;
              fadeSections.unobserve(target);
              context.add(() => {
                gsap.from(target, { opacity: .88, duration: .2, ease: "none", clearProps: "opacity" });
              });
            });
          });
          selectAll(".story-section").forEach(section => fadeSections.observe(section));
          return () => fadeSections.disconnect();
        }

        const letters = selectAll("[data-letter]");
        if (!hasEntered) {
          hasEntered = true;
          const intro = gsap.timeline({ defaults: { overwrite: "auto" } });
          finishIntro = () => { intro.progress(1); };
          if (loader) {
            loader.hidden = false;
            intro.fromTo(loader.querySelector(".tape-wheel"), { rotation: -100, x: -32 }, { rotation: 0, x: 0, duration: .34, ease: "back.out(1.6)" })
              .to(loader, { yPercent: -102, duration: .42, ease: "power3.inOut", onComplete: () => { loader.hidden = true; } });
          }
          intro.addLabel("reveal", loader ? "-=.21" : 0)
            .from("[data-hero-roll]", { yPercent: -48, rotation: -42, opacity: 0, duration: .72, ease: "bounce.out" }, "reveal")
            .from(letters, { yPercent: 62, scaleX: .72, scaleY: 1.28, opacity: 0, duration: .48, stagger: .035, ease: "back.out(2.4)" }, "reveal+=.06")
            .from("[data-hero-sticker]", { scale: 1.35, opacity: 0, duration: .24, stagger: .085, ease: "power4.in" }, "reveal+=.33");
        }

        if (finePointer.matches) {
          const heading = select("#launch-title");
          pointerEvents = new AbortController();
          const { signal } = pointerEvents;
          let centers: number[] = [];
          const pushes = letters.map(letter => gsap.quickTo(letter, "y", { duration: .28, ease: "power2.out" }));
          heading?.addEventListener("pointerenter", () => {
            centers = letters.map(letter => {
              const box = letter.getBoundingClientRect();
              return box.left + box.width / 2;
            });
          }, { signal });
          heading?.addEventListener("pointermove", event => {
            if (!centers.length) return;
            pushes.forEach((push, i) => push(-12 * Math.max(0, 1 - Math.abs(centers[i] - event.clientX) / 64)));
          }, { signal });
          heading?.addEventListener("pointerleave", () => pushes.forEach(push => push(0)), { signal });
        }

        // Start the small roll where the hero tape meets the first section.
        gsap.set(track, { top: firstSeam.offsetTop });
        const setTrackTop = gsap.quickSetter(track, "top", "px");
        const positionTrack = () => setTrackTop(firstSeam.offsetTop);
        ScrollTrigger.addEventListener("refreshInit", positionTrack);
        gsap.to("[data-roll-drift]", {
          yPercent: 22, xPercent: 15, rotation: 12, scale: .8, opacity: .25, ease: "none",
          scrollTrigger: { trigger: hero, start: "top top", end: "bottom 20%", scrub: .35 },
        });
        gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: firstSeam, start: "top 75%", endTrigger: footer, end: "bottom bottom",
            scrub: .35, invalidateOnRefresh: true,
          },
        }).fromTo("[data-traveler]", { y: 0, rotation: -26 }, {
          y: () => Math.max(0, track.clientHeight - 34), rotation: 685, duration: 1,
        }, 0).fromTo("[data-trail]", { scaleY: 0 }, { scaleY: 1, duration: 1 }, 0);
        selectAll("[data-seam]").forEach(seam => {
          gsap.from(seam, {
            scaleX: .24, ease: "none",
            scrollTrigger: { trigger: seam.parentElement, start: "top 96%", end: "top 65%", scrub: .28 },
          });
        });

        const sections = [
          { section: roomSection, cards: selectAll(".entry-card"), tape: selectAll("[data-stamp]") },
          { section: productsSection, cards: selectAll("[data-product]"), tape: [] },
        ];
        sections.forEach(({ section, cards, tape }) => {
          if (!cards.length) return;
          const forms = section === roomSection;
          const timeline = gsap.timeline({ scrollTrigger: { trigger: section, start: "top 87%", once: true } });
          timeline.from(cards, {
            x: i => forms ? (i % 2 ? 32 : -32) : 0,
            y: forms ? 16 : -34,
            rotation: i => i % 2 ? 4 : -4,
            duration: .72, stagger: .1, ease: forms ? "elastic.out(1,.65)" : "bounce.out",
            clearProps: "transform",
          });
          if (tape.length) timeline.from(tape, { scale: 1.8, opacity: 0, duration: .24, stagger: .09, ease: "power4.in" }, "-=.2");
        });

        const visuals = selectAll("[data-step-visual]");
        gsap.set(visuals.slice(1), { autoAlpha: 0, y: 22, rotation: 6 });
        const workflowTimeline = gsap.timeline({
          scrollTrigger: { trigger: workflow, start: "top 48%", end: "bottom 85%", scrub: .35 },
        });
        workflowTimeline.to("[data-workflow-progress]", { scaleX: 1, ease: "none", duration: 3 }, 0);
        visuals.slice(1).forEach((visual, i) => {
          workflowTimeline.to(visuals[i], { autoAlpha: 0, y: -18, duration: .32 }, i + .8)
            .to(visual, { autoAlpha: 1, y: 0, rotation: 0, duration: .42, ease: "back.out(1.6)" }, i + .9);
        });

        const belt = gsap.to(marquee, { xPercent: -50, duration: 19, ease: "none", repeat: -1, paused: true });
        const settleSpeed = gsap.delayedCall(.12, () => belt.timeScale(1)).pause();
        ScrollTrigger.create({
          trigger: marquee.parentElement, start: "top bottom", end: "bottom top",
          onToggle: self => { belt.paused(!self.isActive); },
          onUpdate: self => {
            if (!self.isActive) return;
            belt.timeScale(1 + Math.min(Math.abs(self.getVelocity()) / 1150, 5));
            settleSpeed.restart(true);
          },
        });

        gsap.timeline({ scrollTrigger: { trigger: footer, start: "top 92%", once: true } })
          .from("[data-wordmark]", { y: 32, rotation: -5, duration: .56, ease: "back.out(1.7)" })
          .from("[data-footer-tape]", { scale: 1.7, opacity: 0, duration: .26, ease: "power4.in" }, "-=.16");

        return () => ScrollTrigger.removeEventListener("refreshInit", positionTrack);
      });
      queueRefresh();
    };

    const onToggle = () => { paused = !paused; configure(); };
    const dismissIntro = () => finishIntro?.();
    toggle.addEventListener("click", onToggle);
    prefersReduced.addEventListener("change", configure);
    finePointer.addEventListener("change", configure);
    root.addEventListener("focusin", dismissIntro);
    window.addEventListener("resize", queueRefresh);
    document.fonts.addEventListener("loadingdone", queueRefresh);
    const observer = new ResizeObserver(queueRefresh);
    observer.observe(root);
    configure();
    void document.fonts.ready.then(() => { if (ref.current === root) queueRefresh(); });

    return () => {
      pointerEvents?.abort();
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      prefersReduced.removeEventListener("change", configure);
      finePointer.removeEventListener("change", configure);
      root.removeEventListener("focusin", dismissIntro);
      window.removeEventListener("resize", queueRefresh);
      document.fonts.removeEventListener("loadingdone", queueRefresh);
      toggle.removeEventListener("click", onToggle);
      context.revert();
      if (loader) loader.hidden = true;
      delete root.dataset.motion;
    };
  }, [ref]);
}
