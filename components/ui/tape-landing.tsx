import { useRef, type ReactNode } from "react";
import { ArrowDown, Clipboard, File, Hash, Image, Link2, NotebookPen, Plus } from "lucide-react";
import { RoomHero } from "./room-hero";
import { useTapeMotion } from "./use-tape-motion";

const productIcons = { text: NotebookPen, links: Link2, images: Image, files: File };
const steps = [
  { title: "Make a room.", text: "Name your room and choose a code or generate one automatically.", Icon: Plus, sample: "Design team" },
  { title: "Pass the code.", text: "Share a link, room code, or QR so your teammates can jump straight in.", Icon: Hash, sample: "DESIGN-TEAM" },
  { title: "Drop it in.", text: "Post a note, link, image, or file. Everyone in the room can pick it up.", Icon: Clipboard, sample: "Ready to share!" },
];

export interface TapeLandingProps {
  brand: string;
  headline: string | readonly string[];
  products: ReadonlyArray<{ title: string; description: string; kind: keyof typeof productIcons }>;
  preloader?: boolean;
  fontHref?: string;
  className?: string;
  roomForms?: ReactNode;
}

function TapeRoll() {
  return <span className="tape-wheel"><span /></span>;
}

function TapeSeam() {
  return <div className="story-seam" aria-hidden="true"><span data-seam /></div>;
}

function Marquee({ brand }: { brand: string }) {
  return (
    <div className="story-marquee" aria-hidden="true">
      <div className="marquee-belt flex" data-marquee>
        {[0, 1].map(copy => (
          <div className="marquee-lap flex shrink-0" key={copy}>
            {Array.from({ length: 5 }, (_, index) => (
              <span className="marquee-label" key={index}>{brand} <span>✦</span> Pass it on <span>✦</span></span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TapeLanding({ brand, headline, products, preloader = false, fontHref, className, roomForms }: TapeLandingProps) {
  const root = useRef<HTMLDivElement>(null);
  useTapeMotion(root);
  const headlineLines = typeof headline === "string" ? headline.split(/\r?\n/) : headline;

  return (
    <div ref={root} className={["tape-story", className].filter(Boolean).join(" ")}>
      {fontHref && <link rel="stylesheet" href={fontHref} precedence="landing" />}
      {preloader && (
        <div className="story-preloader" data-preloader hidden aria-hidden="true">
          <div className="preloader-lockup"><TapeRoll /><span>{brand}</span></div>
        </div>
      )}
      <RoomHero brand={brand} headline={headlineLines} />
      <div className="story-track" aria-hidden="true">
        <span className="story-trail" data-trail />
        <div className="story-spool" data-traveler>
          <TapeRoll />
        </div>
      </div>
      <TapeSeam />
      <section className="entry-stage story-section" id="story-rooms" aria-label="Room setup">
        {roomForms ?? (
          <div className="shell landing-grid">
            <article id="create" className="card entry-card">
              <span className="form-tape" data-stamp aria-hidden="true" />
              <h2>Create a room</h2>
              <a className="btn btn-md mt-4" href="#workflow-title">See how it works</a>
            </article>
            <article id="join" className="card entry-card">
              <span className="form-tape" data-stamp aria-hidden="true" />
              <h2>Join with a code</h2>
              <a className="btn btn-md mt-4" href="#types-title">See what you can share</a>
            </article>
          </div>
        )}
      </section>
      <TapeSeam />
      <Marquee brand={brand} />
      <section className="workflow-scene story-section" aria-labelledby="workflow-title">
        <div className="shell workflow-layout">
          <div className="workflow-stage">
            <div className="workflow-stage-card flex flex-col justify-between">
              <h2 id="workflow-title">Share in three steps</h2>
              <div className="workflow-visual" aria-hidden="true">
                {steps.map(({ Icon, sample }) => (
                  <div data-step-visual className="workflow-slip" key={sample}>
                    <Icon /><span>{sample}</span>
                  </div>
                ))}
              </div>
              <div className="workflow-annotation" aria-hidden="true">Pass it on! <ArrowDown /></div>
              <div className="workflow-meter" aria-hidden="true"><span data-workflow-progress /></div>
            </div>
          </div>
          <ol className="workflow-steps">
            {steps.map(({ title, text }, index) => (
              <li className="workflow-step" data-step key={title}>
                <div className="card workflow-ticket">
                  <span className="workflow-number" aria-hidden="true">0{index + 1}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <TapeSeam />
      <section className="content-types story-section" aria-labelledby="types-title">
        <div className="shell">
          <h2 id="types-title">What you can share</h2>
          <div className="type-grid">
            {products.map(({ title, description, kind }) => {
              const Icon = productIcons[kind];
              return <article className="card type-tile" data-product={kind} key={kind}>
                <Icon aria-hidden="true" /><h3>{title}</h3><p>{description}</p>
              </article>;
            })}
          </div>
        </div>
      </section>
      <TapeSeam />
      <footer className="story-footer story-section">
        <div className="shell flex flex-col items-start">
          <div className="footer-lockup">
            <p className="story-wordmark" data-wordmark>{brand}.</p>
            <span className="footer-tape" data-footer-tape aria-hidden="true" />
          </div>
          <p>Anyone with a room code can join. No account needed.</p>
        </div>
      </footer>
    </div>
  );
}
