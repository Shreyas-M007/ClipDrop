import { Clipboard, File, Link2, NotebookPen, Pause, Play } from "lucide-react";

function HeadlineLine({ line }: { line: string }) {
  return line.trim().split(/\s+/).map((word, index) => (
    <span className="headline-word" key={index}>
      {Array.from(word).map((letter, position) => (
        <span className="headline-letter" data-letter key={position}>{letter}</span>
      ))}
    </span>
  ));
}

export function RoomHero({ brand, headline }: { brand: string; headline: readonly string[] }) {
  return (
    <section className="launch-hero" aria-labelledby="launch-title">
      <div className="launch-shell">
        <div className="launch-copy">
          <h1 id="launch-title" aria-label={headline.join(" ")}>
            {headline.map((line, index) => {
              const Line = index === 0 ? "span" : "em";
              return <Line className="headline-line" aria-hidden="true" key={index}><HeadlineLine line={line} /></Line>;
            })}
          </h1>
          <p>Text, links, images, and files in one shared room. Invite anyone with a code or QR scan.</p>
          <div className="launch-actions">
            <a className="btn btn-lg primary launch-button" href="#create">Create a room</a>
            <a className="btn btn-lg secondary launch-button" href="#join">Join with a code</a>
          </div>
        </div>
        <div className="launch-stage" id="launch-stage">
          <div className="launch-scene" aria-hidden="true">
            <div className="roll-tail"></div>
            <div className="launch-roll-drift" data-roll-drift>
              <div className="art-roll" data-hero-roll>
                <span className="roll-barrel"><b>{brand}</b></span>
                <span className="roll-face"><i /></span>
                <span className="roll-glint" />
              </div>
            </div>
            <div className="art-sticker art-note" data-hero-sticker><NotebookPen /><span>TEXT</span></div>
            <div className="art-sticker art-file" data-hero-sticker><File /><span>FILES</span></div>
            <div className="art-sticker art-link" data-hero-sticker><Link2 /><span>LINKS</span></div>
            <div className="art-stamp"><Clipboard /></div>
          </div>
          <button className="icon-button motion-toggle" id="motion-toggle" type="button"
            aria-label="Pause landing animations" title="Pause landing animations" hidden>
            <Pause className="pause-icon" aria-hidden />
            <Play className="play-icon" aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
