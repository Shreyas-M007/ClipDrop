import { createRoot } from "react-dom/client";
import { GoRide } from "@/components/ui/goride";

const target = document.getElementById("launch");
if (target) createRoot(target).render(<GoRide />);
