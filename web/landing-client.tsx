import { hydrateRoot } from "react-dom/client";
import { ClipdropLanding } from "./landing";

const container = document.getElementById("home");
if (container) hydrateRoot(container, <ClipdropLanding />);
