import type { ProductId } from '@/lib/swarm/deal-plan';

/**
 * Discovery questions written for the kind of business being called.
 * They should sound like a person talking: short, one idea each, about their day rather than our product.
 * `{place}` becomes "the shop", "the restaurant", "the practice"… and `{name}` is the business name.
 */
export type ProfileId = 'trades' | 'restaurant' | 'beauty' | 'auto' | 'medical' | 'office' | 'retail' | 'lodging' | 'fitness' | 'faith' | 'childcare' | 'industrial' | 'general';
/** The question, then the natural follow-up once they answer. */
export type Ask = [question: string, followUp: string];
export type Profile = {
  id: ProfileId; label: string; place: string; test: RegExp;
  /** Who to ask the person who answers for, the way a receptionist would say it. */
  gatekeeper: string;
  open: string[];
  ask: Partial<Record<ProductId, Ask>>;
};

/**
 * Field crews and home services. Exported so deal-plan's product reasoning and this
 * profile's selection share one definition instead of two copies drifting apart.
 * Roots like `plumb` and `electric` use `\w*` so "Plumbing"/"Plumber" and
 * "Electrical"/"Electrician" match too — `\b(plumb)\b` alone only matches the bare
 * word "plumb", never its real-world category forms.
 */
export const CREW = /\b(home ?care|home health|hospice|caregiv\w*|in-home|hvac|refrigeration|heating|air condition\w*|plumb\w*|electric\w*|roof\w*|landscap\w*|lawn|pest|termite|exterminat\w*|clean\w*|janitor\w*|maid|pressure wash|pool|construction|contractor|builder|remodel|handyman|painting|painter|drywall|flooring|concrete|paving|fence|gutter|tree|towing|tow service|moving|movers|junk|hauling|septic|well drilling|excavat\w*|garage door|locksmith|appliance repair|courier|delivery|security system|alarm)\b/i;

const GENERIC: Record<ProductId, Ask> = {
  internet: ['Who do you have for internet right now, and how has it been?', 'When was the last time it gave you trouble?'],
  mobile: ['How many of you carry a phone for work?', 'Is that on a business plan, or is everyone using their own?'],
  voice: ['When someone calls the main number, who usually picks up?', 'What happens to the call when nobody can get to it?'],
  tv: ['Do you keep a TV on for customers?', 'What are you using for it right now?'],
  wifi: ['Do customers ever ask for your Wi-Fi?', 'Is that the same network your own computers are on?'],
  backup: ['If the internet went out on a busy day, could you still take cards?', 'Has that happened to you before?'],
  static_ip: ['Do you ever check your cameras from your phone?', 'Does that connection ever drop on you?'],
  connect: ['When you are away from {place}, how do calls to the business reach you?', 'Do you end up giving customers your cell number?'],
};

export const PROFILES: Profile[] = [
  {
    id: 'lodging', label: 'Lodging', place: 'the property', test: /\b(hotel|motel|inn|lodge|suites|bed (?:and|&) breakfast|b&b|guest ?house|cabins?|cottages?|hostel|extended stay|campground|rv park)\b/i,
    gatekeeper: 'the owner or whoever runs the property',
    open: ['How many rooms do you have?', 'How do most of your guests book with you?', 'Are you pretty full on weekends?'],
    ask: {
      wifi: ['What do guests say about the Wi-Fi?', 'Do the rooms farther from the office have a harder time?'],
      internet: ['Besides guest Wi-Fi, what runs on your internet?', 'What happens when it goes down with a full house?'],
      tv: ['What do guests get for TV in the rooms?', 'Do you ever hear complaints about it?'],
      voice: ['How do guests reach somebody at night?', 'Who answers the phone while you are checking someone in?'],
      static_ip: ['Do you check your cameras or door locks from your phone?', 'How do you find out when one goes offline?'],
    },
  },
  {
    id: 'faith', label: 'Church or nonprofit', place: 'the building', test: /\b(church|chapel|ministr\w*|parish|congregation|temple|mosque|synagogue|nonprofit|non-profit|foundation|food pantry|faith)\b/i,
    gatekeeper: 'the pastor or the church office administrator',
    open: ['Besides Sunday, what is the building used for during the week?', 'Do you stream your services?', 'Who looks after the phones and internet for you?'],
    ask: {
      internet: ['What do you use the internet for at the church?', 'Has it ever gone out during a service?'],
      voice: ['Who answers the phone during the week?', 'Where do calls go when the office is empty?'],
      wifi: ['Do visitors or groups using the building ask for Wi-Fi?', 'Is that kept separate from the office computers?'],
      mobile: ['Does the church cover anyone\'s phone, or does staff use their own?', 'How many people would that be?'],
    },
  },
  {
    id: 'childcare', label: 'Childcare', place: 'the center', test: /\b(daycare|child ?care|preschool|pre-k|learning center|nursery school|montessori|after ?school)\b/i,
    gatekeeper: 'the director',
    open: ['How many kids do you have enrolled right now?', 'How do parents usually reach you during the day?', 'Do parents get a camera feed or an app?'],
    ask: {
      voice: ['Who answers the phone when every teacher has a room full of kids?', 'Do parents ever tell you they could not get through?'],
      internet: ['How much of your day runs on the internet, like check-in and the parent app?', 'What happens when it goes down?'],
      static_ip: ['Can parents watch the cameras from home?', 'Does the feed ever cut out on them?'],
      wifi: ['Do the classrooms use tablets on your Wi-Fi?', 'Is that separate from the office network?'],
    },
  },
  {
    id: 'trades', label: 'Trades and field crews', place: 'the shop', test: CREW,
    gatekeeper: 'the owner, or whoever handles the office',
    open: ['How many trucks do you have running right now?', 'Is this a busy time of year for you?', 'How do most of your jobs come in?'],
    ask: {
      mobile: ['How many people on your crew carry a phone for work?', 'Are they on a company plan, or using their own?'],
      connect: ['When everybody is out on jobs, who answers the phone?', 'How many calls do you think go to voicemail in a day?'],
      internet: ['What do you mostly use the internet for at the office?', 'Does it give you any trouble?'],
      voice: ['How many lines come into the office?', 'What happens when two customers call at once?'],
      static_ip: ['Do you have cameras on the yard or the trucks?', 'Can you pull them up from your phone?'],
    },
  },
  {
    id: 'medical', label: 'Medical and dental', place: 'the practice', test: /\b(dental|dentist|orthodont\w*|chiropract\w*|clinic|medical|physician|doctor|dermatolog\w*|pediatric\w*|family practice|optometr\w*|eye care|veterinar\w*|animal hospital|vet clinic|urgent care|physical therapy|therap\w*|counsel\w*|pharmacy|podiatr\w*|audiolog\w*)\b/i,
    gatekeeper: 'the office manager',
    open: ['How many providers do you have seeing patients?', 'What is the front desk like first thing in the morning?', 'How do most patients book with you?'],
    ask: {
      internet: ['How does your system hold up when you are pulling records and checking insurance all day?', 'What happens to the schedule if it goes down?'],
      voice: ['How many lines ring at the front desk?', 'Do patients ever tell you they could not get through?'],
      backup: ['If the internet went out mid-morning, could you keep seeing patients?', 'Has that happened before?'],
      static_ip: ['Does anyone log in to your system from outside the office, like your software vendor?', 'How is that set up right now?'],
      wifi: ['Do patients use Wi-Fi in the waiting room?', 'Is that kept separate from the office network?'],
      tv: ['Is there a TV in the waiting room?', 'How long do people usually wait out there?'],
      connect: ['After hours, where do calls to the office go?', 'Does anyone end up using their personal cell for that?'],
    },
  },
  {
    id: 'beauty', label: 'Salon, barber, or spa', place: 'the shop', test: /\b(barber|salon|hair|nail|spa|lash|brow|massage|tattoo|waxing|grooming|tanning)\b/i,
    gatekeeper: 'the owner',
    open: ['How many chairs do you have?', 'Do most people book ahead or walk in?', 'What are Saturdays like?'],
    ask: {
      internet: ['How is your internet holding up with the card reader and booking app going?', 'Has it ever cut out with a client in the chair?'],
      wifi: ['Do clients ask for Wi-Fi while they are sitting?', 'Is it separate from what your card reader uses?'],
      tv: ['Do you keep a TV on in the shop?', 'What are you using for it?'],
      voice: ['Who answers the phone when everybody has a client?', 'Do you think you lose bookings that way?'],
      backup: ['If your card reader lost the internet mid-appointment, could you still get paid?', 'How often has that happened?'],
    },
  },
  {
    id: 'auto', label: 'Auto and tire', place: 'the shop', test: /\b(auto|tire|mechanic|body shop|collision|oil change|car wash|dealership|motors|transmission|muffler|brake|detailing)\b/i,
    gatekeeper: 'the owner or the service manager',
    open: ['How many bays are you running?', 'Are you staying pretty booked up?', 'Do most customers wait or drop off?'],
    ask: {
      internet: ['How much of the shop runs on the internet, like parts lookup and estimates?', 'Does it ever slow you down with a car on the lift?'],
      tv: ['Do you have a TV in the waiting area?', 'What are you using for it now?'],
      wifi: ['Do waiting customers ask for Wi-Fi?', 'Is it separate from your shop computers?'],
      voice: ['Who picks up the phone when everybody is under a car?', 'Do you think people just call the next shop?'],
      static_ip: ['Do you have cameras you check from home?', 'Does that ever stop working?'],
      backup: ['If the internet went out, could you still look up parts and take payment?', 'How long could you get by like that?'],
    },
  },
  {
    id: 'restaurant', label: 'Restaurant or bar', place: 'the restaurant', test: /\b(restaurant|pizza|pizzeria|grill|cafe|café|coffee|bakery|diner|deli|wings|tacos?|bbq|catering|bar|pub|tavern|brewery|taproom|saloon|lounge|steakhouse|sushi|kitchen|eatery|smokehouse|donut|ice cream|bistro|hospitality|food)\b/i,
    gatekeeper: 'the owner or the general manager',
    open: ['How has business been lately?', 'What does a Friday night look like for you?', 'Are you doing much takeout or delivery?'],
    ask: {
      internet: ['What is the internet like on a Friday night when you are slammed?', 'Has it ever gone down on you in the middle of a rush?'],
      backup: ['If the internet dropped during dinner, could you still run cards?', 'What did you do the last time that happened?'],
      voice: ['When the phone rings during the dinner rush, who grabs it?', 'Do you think you miss many takeout calls?'],
      tv: ['Do you have TVs up for the games?', 'What are you paying for those right now?'],
      wifi: ['Do people ask for your Wi-Fi?', 'Is it on the same network as your register?'],
      mobile: ['Do you and your managers use your own phones for the restaurant?', 'Who ends up paying for those?'],
    },
  },
  {
    id: 'fitness', label: 'Gym or studio', place: 'the gym', test: /\b(gym|fitness|crossfit|boxing|martial arts|karate|yoga|pilates|dance|athletic|cycling|climbing|bowling|billiards)\b/i,
    gatekeeper: 'the owner or the manager',
    open: ['How many members do you have right now?', 'When is your busiest time of day?', 'How do people check in?'],
    ask: {
      tv: ['Do you have TVs on the floor?', 'What are you using for them?'],
      wifi: ['Do members use your Wi-Fi while they work out?', 'Does it hold up at your busiest hour?'],
      internet: ['What happens to check-in and billing if the internet goes down?', 'Has that happened to you?'],
      static_ip: ['Do you manage the doors or cameras from your phone?', 'Does that ever drop?'],
      backup: ['If the internet went out at peak time, could members still get in?', 'What would you do in the meantime?'],
    },
  },
  {
    id: 'office', label: 'Professional office', place: 'the office', test: /\b(law|attorney|legal|cpa|accounting|accountant|tax|bookkeep|insurance|realty|real estate|mortgage|title|financial|advis|consult|agency|architect|engineer|staffing|property management|funeral|marketing|design|professional services)\b/i,
    gatekeeper: 'the office manager',
    open: ['How many people are in the office?', 'Does anyone work from home?', 'How do new clients usually find you?'],
    ask: {
      internet: ['How is your internet with everyone on video calls and cloud files?', 'Has it ever cost you a deadline or a client call?'],
      voice: ['How are calls handled when someone is out or on another line?', 'How fast do clients expect a call back?'],
      connect: ['When you are out of the office, how do you take calls on the main number?', 'Do clients end up with your personal cell?'],
      mobile: ['Does the business pay for anyone\'s cell phone?', 'How many people would that be?'],
      backup: ['If the internet went out on a deadline day, what would you do?', 'Has it happened before?'],
      static_ip: ['Does anyone connect to the office network from home?', 'Who set that up for you?'],
      wifi: ['Do clients come in and use your Wi-Fi?', 'Is it separate from your work network?'],
    },
  },
  {
    id: 'retail', label: 'Retail', place: 'the store', test: /\b(retail|store|shop|boutique|market|liquor|vape|smoke|florist|pet|grocery|gas|convenience|jewel\w*|pawn|gift|furniture|hardware|antique|thrift|bookstore|dispensary|cannabis|firearm|gun|outfitters)\b/i,
    gatekeeper: 'the owner or the store manager',
    open: ['What kind of customers come in the most?', 'What is your busiest day?', 'Do you sell online too, or mostly in the store?'],
    ask: {
      internet: ['How is your internet holding up with the card machine and everything else?', 'Has it ever lagged at checkout?'],
      backup: ['If the internet went out on a Saturday, could you still take cards?', 'What did you do the last time?'],
      wifi: ['Do shoppers ask for Wi-Fi?', 'Would you want them to have it, or is it just for you?'],
      voice: ['Do people call to check if you have something in stock?', 'Who picks up when you are helping a customer?'],
      static_ip: ['Do you check your cameras from home?', 'Have you ever needed footage and could not pull it up?'],
      mobile: ['Do you use your cell for the store, like texting customers?', 'Is that on a business plan?'],
    },
  },
  {
    id: 'industrial', label: 'Farm, warehouse, or industrial', place: 'the site', test: /\b(farm|ranch|feed|storage|warehouse|manufactur\w*|machine|welding|fabricat\w*|equine|nursery|greenhouse|supply|distribut\w*|logistic\w*|trucking|freight|lumber|sawmill|quarry|orchard|dairy|livestock|grain|equipment|agricultur\w*)\b/i,
    gatekeeper: 'the owner or the operations manager',
    open: ['How many people are out here on a normal day?', 'How far out are you from town?', 'Do you get decent cell signal on the property?'],
    ask: {
      internet: ['What do you rely on the internet for out here?', 'When it goes down, what stops?'],
      static_ip: ['Do you have cameras or gates you check from your phone?', 'How do you know when one goes offline?'],
      mobile: ['How many people carry a phone for work?', 'Any dead spots on the property or on your routes?'],
      connect: ['When nobody is in the office, how do calls reach you?', 'Do people end up calling your cell?'],
    },
  },
  {
    id: 'general', label: 'Local business', place: 'your location', test: /^/,
    gatekeeper: 'the owner, or whoever handles the phones and internet',
    open: ['How long have you been in business?', 'What does a normal day look like for you?', 'How many people work with you?'],
    ask: {},
  },
];

/** Asked at the end of every call, whatever the business. */
export const CLOSING: string[] = [
  'Is anyone else part of the decision on phones and internet?',
  'When is your contract up with who you have now?',
  'If you could change one thing about your service, what would it be?',
];

export function profileFor(text: string): Profile {
  return PROFILES.find(profile => profile.test.test(text)) ?? PROFILES[PROFILES.length - 1];
}

export function fill(template: string, context: { name: string; place: string }) {
  return template.replaceAll('{place}', context.place).replaceAll('{name}', context.name);
}

export function askFor(profile: Profile, product: ProductId, context: { name: string; place: string }): Ask {
  const ask = profile.ask[product] ?? GENERIC[product];
  return ask.map(item => fill(item, context)) as Ask;
}
