import { TapeLanding } from "@/components/ui/tape-landing";
import roomForms from "./room-forms.html";

export function ClipdropLanding() {
  return <TapeLanding
    brand="Clipdrop"
    headline={["DROP IT.", "SHARE IT."]}
    products={[
      { title: "Text", description: "Notes, snippets, and ideas.", kind: "text" },
      { title: "Links", description: "Resources and references.", kind: "links" },
      { title: "Images", description: "Screenshots and visuals.", kind: "images" },
      { title: "Files", description: "Documents and attachments.", kind: "files" },
    ]}
    preloader
    roomForms={<div className="room-forms" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: roomForms }} />}
  />;
}
