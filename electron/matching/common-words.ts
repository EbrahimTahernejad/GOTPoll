// Very common English words. A chat message made ONLY of these ("love you",
// "up to you", "this is so good") is almost always chatter, so it may only
// match a title exactly (e.g. "your name") or via a taught alias – never
// fuzzily.
export const COMMON_WORDS = new Set(
  `a about above after again against all almost also always am an and another any anyone anything are
  around as ask at away back bad be because been before being best better between big bit both but by
  can cant come could day did didnt do does doesnt doing done dont down each either else end enough even
  ever every everyone everything far feel few find first for from fun get gets getting give go goes going
  gone good got great had has have having he her here hers him his how i id if im in into is isnt it its
  ive just keep kind know last least less let lets life like little live long look lot love made make
  many maybe me mean might mine more most much must my myself need never new next nice no none nor not
  nothing now of off oh ok okay old on once one only or other our out over own people please pls plz
  pretty put rather real really right said same say see seen she should show so some someone something
  still such sure take than thank thanks that thats the their them then there these they thing things
  think this those though through time to today too try two up us use very want was wasnt way we well
  were what whats when where which while who whole why will with without wont would yeah yes yet you
  your youre yours yourself again guys chat stream streamer vote votes voting poll win wins winner
  lol omg wow hi hello hey bye yo sup ty thx gg wp yep nope nah idk idc tbh imo ngl fr`.split(/\s+/)
);
