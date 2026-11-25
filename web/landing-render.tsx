import { renderToString } from "react-dom/server";
import { ClipdropLanding } from "./landing";

export function renderLanding() {
  return renderToString(<ClipdropLanding />);
}
