import { Clipboard, File, Image, NotebookPen, Pause, Play } from "lucide-react";

export function RoomHero() {
  return (
    <section className="launch-hero" aria-labelledby="launch-title">
      <div className="launch-copy">
        <h1 id="launch-title">Share it. <em>Skip the setup.</em></h1>
        <p>Put text, links, images, and files in one room. Send a code or QR invite so anyone can join from their browser.</p>
        <div className="launch-actions">
          <a className="button primary launch-button" href="#create">Create a room</a>
          <a className="button secondary launch-button" href="#join">Join with a code</a>
        </div>
      </div>
      <div className="launch-stage" id="launch-stage">
        <div className="launch-scene" aria-hidden="true">
          <div className="scene-arcs"><i /><i /><span /></div>
          <div className="scene-hub"><Clipboard /></div>
          <picture className="scene-people">
            <source media="(max-width: 700px)" srcSet="/collaborators-760.webp" />
            <img src="/collaborators-1540.webp" alt="" width={1540} height={513}
              fetchPriority="high" decoding="async" />
          </picture>
          <div className="scene-card scene-note"><span><NotebookPen /></span> Note shared</div>
          <div className="scene-card scene-image"><span><Image /></span> Image added</div>
          <div className="scene-card scene-file"><span><File /></span> File ready</div>
        </div>
        <button className="icon-button motion-toggle" id="motion-toggle" type="button"
          aria-label="Pause illustration animation" title="Pause illustration animation" hidden>
          <Pause className="pause-icon" aria-hidden />
          <Play className="play-icon" aria-hidden />
        </button>
      </div>
    </section>
  );
}
