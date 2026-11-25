import { Clipboard, File, Link2, NotebookPen, Pause, Play } from "lucide-react";

export function RoomHero() {
  return (
    <section className="launch-hero" aria-labelledby="launch-title">
      <div className="launch-shell">
        <div className="launch-copy">
          <h1 id="launch-title"><span>DROP IT.</span><em>SHARE IT.</em></h1>
          <p>Text, links, images, and files in one shared room. Invite anyone with a code or QR scan.</p>
          <div className="launch-actions">
            <a className="button primary launch-button" href="#create">Create a room</a>
            <a className="button secondary launch-button" href="#join">Join with a code</a>
          </div>
        </div>
        <div className="launch-stage" id="launch-stage">
          <div className="launch-scene" aria-hidden="true">
            <div className="roll-tail"></div>
            <div className="art-roll">
              <span className="roll-barrel"><b>CLIPDROP</b></span>
              <span className="roll-face"><i /></span>
              <span className="roll-glint" />
            </div>
            <div className="art-sticker art-note"><NotebookPen /><span>TEXT</span></div>
            <div className="art-sticker art-file"><File /><span>FILES</span></div>
            <div className="art-sticker art-link"><Link2 /><span>LINKS</span></div>
            <div className="art-stamp"><Clipboard /></div>
          </div>
          <button className="icon-button motion-toggle" id="motion-toggle" type="button"
            aria-label="Pause illustration animation" title="Pause illustration animation" hidden>
            <Pause className="pause-icon" aria-hidden />
            <Play className="play-icon" aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
