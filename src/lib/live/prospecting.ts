import type { Prospect } from "@/lib/types";
import { homeBasedVerdict } from "@/lib/live/filters";
import { collectSalesEvidence, groundedCallOpener, type SalesEvidence } from "@/lib/live/sales-coach";

/** A discovery conversation, with qualification kept separate from sales claims. */
export function prepareOutreach(prospect: Prospect, evidence: SalesEvidence = collectSalesEvidence(prospect)) {
  const home = homeBasedVerdict(prospect);
  const questions = [
    "Do you handle the internet and phone decisions for the business?",
    home.homeBased ? "Do you run the office from home, a separate location, or mostly on the road?" : "Where do you handle the office side of the business?",
    ...evidence.discoveryQuestions.slice(1, 2),
    "Is anything about reliability, coverage, or the monthly bill getting in the way — or is it working well enough?",
    "Are you considering a change, and is there a contract or renewal date to work around?",
  ];
  const opener = groundedCallOpener(prospect, evidence);
  const triggerLine = evidence.trigger
    ? `I noticed ${evidence.trigger.replace(/\.$/, "")}. If that is changing how you run the shop, I can check options for the address — only if useful.`
    : evidence.discoveryQuestions[1];
  return {
    callOpener: opener,
    followUpEmail: {
      subject: `Internet and phone for ${prospect.name}`,
      body: `Hi,\n\nI’m [your name] with Spectrum Business. ${triggerLine}\n\nI do not want to assume a problem on your side. If reliability, coverage, or cost is something you’d like to improve, I can check the options for your business address.\n\nWould a brief conversation make sense?\n\n[your name]\n[your contact information]`,
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
