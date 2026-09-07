import type { Prospect } from "@/lib/types";
import { homeBasedVerdict } from "@/lib/live/filters";

/** A discovery conversation, with qualification kept separate from sales claims. */
export function prepareOutreach(prospect: Prospect) {
  const home = homeBasedVerdict(prospect);
  const businessType = `${prospect.category} ${prospect.name} ${prospect.publicNotes || ""}`;
  const useQuestion = /contract|construction|deck|landscap|plumb|roof|handyman/i.test(businessType)
    ? "How do you handle customer calls, quotes, and scheduling when you’re out on a job?"
    : /retail|food|restaurant|salon/i.test(businessType)
      ? "What happens to payments and bookings if your connection drops?"
      : "Which parts of the work depend on your internet or business phone?";
  const questions = [
    "Do you handle the internet and phone decisions for the business?",
    home.homeBased ? "Do you run the office from home, a separate location, or mostly on the road?" : "Where do you handle the office side of the business?",
    useQuestion,
    "Is anything about reliability, coverage, or the monthly bill getting in the way?",
    "Are you considering a change, and is there a contract or renewal date to work around?",
  ];
  return {
    callOpener: `Hi, this is [your name] with Spectrum Business. Am I speaking with whoever handles internet and phone for ${prospect.name}? I’m reaching out to see whether there’s anything you’d want working better. ${useQuestion}`,
    followUpEmail: {
      subject: `Internet and phone for ${prospect.name}`,
      body: `Hi,\n\nI’m [your name] with Spectrum Business. ${useQuestion}\n\nIf reliability, coverage, or cost is something you’d like to improve, I can check the options for your business address and see whether there’s a useful fit.\n\nWould a brief conversation make sense?\n\n[your name]\n[your contact information]`,
    },
    qualification: {
      homeBased: home.homeBased ? "Possible home-based lead; confirm operating location" : "Home-based operation not established",
      evidence: home.reasons,
      questions,
      beforeQuoting: [
        "Confirm the exact service address and current orderability; FCC availability is a lead, not an install guarantee.",
        "Confirm current service, new-customer eligibility, and the applicable offer before quoting a promotion or savings.",
        "Agree on a useful next step and record the outcome; do not assume interest or permission to send follow-up.",
      ],
    },
  };
}
