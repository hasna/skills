import type { DeckOptions, Slide } from "./types";
import { askForAudience, audienceGoalPhrase, buyerForAudience, shorten, tonePhrase } from "./utils";

export function buildSlides(options: DeckOptions): Slide[] {
  const voice = tonePhrase(options.tone);
  const audienceGoal = audienceGoalPhrase(options.audience);
  const base: Omit<Slide, "number">[] = [
    {
      title: `${options.company}`,
      subtitle: "Pitch deck",
      bullets: [
        shorten(options.brief, 92),
        `${voice} story for ${audienceGoal}.`,
        "A clear path from problem to proof to next step.",
      ],
      speakerNotes: `Open with the simplest version of the opportunity: ${options.brief}`,
      visualDirection: "Full-bleed product or customer moment with a strong title lockup.",
    },
    {
      title: "The Pain",
      subtitle: "The current workflow costs teams time, trust, or revenue.",
      bullets: [
        "Customers are forced through manual, fragmented work.",
        "Existing tools solve pieces but leave operational gaps.",
        "The pain is frequent enough to justify budget and urgency.",
      ],
      speakerNotes: "Frame the pain in business terms before introducing the product.",
      visualDirection: "Before-state workflow diagram with two or three friction points.",
    },
    {
      title: "Who Needs This",
      subtitle: "The audience is specific, reachable, and budget-aware.",
      bullets: [
        `Primary buyer: ${buyerForAudience(options.audience)}.`,
        "Early users need fast setup, visible results, and low switching cost.",
        "The wedge can expand into adjacent teams after proof.",
      ],
      speakerNotes: "Make the buyer and user concrete. Avoid a generic total-addressable-market story.",
      visualDirection: "Persona strip with buyer, user, and decision trigger.",
    },
    {
      title: "The Product",
      subtitle: "A focused product promise that maps directly to the pain.",
      bullets: [
        shorten(options.brief, 96),
        "Guided setup, automated execution, and reviewable outputs.",
        "Designed for adoption inside an existing SaaS or ops workflow.",
      ],
      speakerNotes: "Show how the product changes the user's day in one sentence.",
      visualDirection: "Three-panel product flow: input, automation, final output.",
    },
    {
      title: "Why Now",
      subtitle: "Timing makes the solution more valuable now than last year.",
      bullets: [
        "Teams expect AI-native workflows but still need control and auditability.",
        "Usage-based software creates pressure for measurable output quality.",
        "The buyer already feels the cost of slow manual execution.",
      ],
      speakerNotes: "Connect market timing to urgency and budget movement.",
      visualDirection: "Timeline with three shifts: behavior, tooling, budget.",
    },
    {
      title: "Proof",
      subtitle: "Evidence that the product can win trust quickly.",
      bullets: [
        "Show concrete examples, usage clips, pilots, or before-and-after results.",
        "Use measurable outcomes where possible: time saved, conversion lift, fewer handoffs.",
        "Make the next validation milestone explicit.",
      ],
      speakerNotes: "Replace placeholders with real metrics as soon as they exist.",
      visualDirection: "Metric cards paired with one customer quote or workflow snapshot.",
    },
    {
      title: "Revenue Engine",
      subtitle: "A simple path from adoption to expansion.",
      bullets: [
        "Start with one high-value job and price around completed outcomes.",
        "Expand through seats, usage, teams, or additional workflow packages.",
        "Keep packaging easy to understand during the first sales cycle.",
      ],
      speakerNotes: "Explain pricing without burying the audience in spreadsheet detail.",
      visualDirection: "Pricing ladder or expansion loop with three steps.",
    },
    {
      title: "Go To Market",
      subtitle: "Reach early buyers through narrow channels before scaling.",
      bullets: [
        "Lead with a painful use case and a crisp demo.",
        "Target communities, agencies, founder-led sales, or partner channels.",
        "Turn every deployment into proof, referrals, and reusable collateral.",
      ],
      speakerNotes: "Make acquisition sound practical and testable.",
      visualDirection: "Channel map from niche audience to repeatable acquisition loop.",
    },
    {
      title: "Roadmap",
      subtitle: "Near-term milestones that reduce risk.",
      bullets: [
        "First: deepen the core workflow and onboarding.",
        "Next: add integrations, admin controls, and reporting.",
        "Later: expand to adjacent jobs with the same product foundation.",
      ],
      speakerNotes: "Keep the roadmap credible. Investors and buyers both reward sequencing.",
      visualDirection: "Three-horizon roadmap with immediate, next, later.",
    },
    {
      title: "The Ask",
      subtitle: "The next step should be concrete.",
      bullets: [
        askForAudience(options.audience),
        "Define success criteria before the next meeting or pilot.",
        "Leave the audience with one decision to make.",
      ],
      speakerNotes: "Close with a precise ask, not a vague invitation.",
      visualDirection: "Single bold callout with next-step checklist.",
    },
    {
      title: "Competitive Edge",
      subtitle: "Why this can win and stay useful.",
      bullets: [
        "Deep workflow fit beats broad generic tooling.",
        "Reviewable outputs build trust with operators and managers.",
        "Distribution compounds through examples, templates, and integrations.",
      ],
      speakerNotes: "Make the edge operational, not just technical.",
      visualDirection: "Two-column comparison: generic tools versus focused workflow.",
    },
    {
      title: "Customer Story",
      subtitle: "A realistic narrative of before and after.",
      bullets: [
        "Before: manual work, inconsistent outputs, and slow review cycles.",
        "After: guided inputs, repeatable execution, and reusable artifacts.",
        "Result: faster throughput and clearer accountability.",
      ],
      speakerNotes: "Swap in a real customer as soon as one is available.",
      visualDirection: "Before-and-after storyboard with customer quote space.",
    },
    {
      title: "Operating Plan",
      subtitle: "How the team executes over the next quarter.",
      bullets: [
        "Ship the narrowest lovable workflow.",
        "Instrument activation, output quality, and repeat usage.",
        "Use weekly learning loops to refine packaging and onboarding.",
      ],
      speakerNotes: "Show that execution risk is understood and actively managed.",
      visualDirection: "Quarter plan with workstreams for product, growth, and success.",
    },
    {
      title: "Risks And Mitigations",
      subtitle: "The credible risks are named and managed.",
      bullets: [
        "Adoption risk: reduce setup time and prove value in one session.",
        "Quality risk: keep outputs reviewable and editable.",
        "Sales risk: focus on buyers with clear budget pain.",
      ],
      speakerNotes: "Acknowledge risk directly and pair each risk with a practical mitigation.",
      visualDirection: "Risk table with severity and mitigation columns.",
    },
    {
      title: "Closing",
      subtitle: "Make the opportunity memorable.",
      bullets: [
        `${options.company} turns ${shorten(options.brief, 64).toLowerCase()} into a repeatable workflow.`,
        "The product is narrow enough to adopt and broad enough to expand.",
        "The next step is clear.",
      ],
      speakerNotes: "End with the one sentence the audience should repeat later.",
      visualDirection: "Confident closing slide with product screenshot or outcome visual.",
    },
  ];

  return base.slice(0, options.slideCount).map((slide, index) => ({
    number: index + 1,
    ...slide,
  }));
}
