import { renderToStaticMarkup } from "react-dom/server";
import { RoomHero } from "@/components/ui/room-hero";

export function renderLanding() {
  return renderToStaticMarkup(<RoomHero />);
}
