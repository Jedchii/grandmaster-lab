// Display profiles and dialogue for the three sparring personas.

import type { MoveNote, PersonaId, PersonaSignal } from '../shared/protocol';

export type DialogueTrigger =
  | 'greet'
  | 'blunderFound'
  | 'mateFound'
  | 'winning'
  | 'losing'
  | 'outOfBook'
  | 'sacrifice'
  | 'repetition'
  | 'perpetual'
  | 'simplify'
  | 'fortress'
  | 'troll'
  | 'engineWins'
  | 'userWins'
  | 'draw';

export interface PersonaProfile {
  id: PersonaId;
  name: string;
  tagline: string;
  avatar: string;
  accent: string;
  engine: string;
  lines: Partial<Record<DialogueTrigger, string[]>>;
}

export const PROFILES: Record<PersonaId, PersonaProfile> = {
  patricia: {
    id: 'patricia',
    name: 'Patricia',
    tagline: 'Killer-bunny attacker',
    avatar: '🐇',
    accent: '#ff5d73',
    engine: 'Patricia 5.1 · Adam Kulju',
    lines: {
      greet: ['Hi! Shall we make this bloody?', 'Pieces are made to be sacrificed.', "Let's skip the boring part."],
      blunderFound: ['Ooh, a gift. Thank you!', 'I saw that. You will regret it.', 'Hop hop — pouncing!'],
      sacrifice: ['Take it. I dare you.', 'Material is temporary. Initiative is forever.', 'A piece for your king? Fair trade.'],
      mateFound: ['Your king has nowhere to hide.', 'Mate is coming. Hop hop.'],
      winning: ['The attack plays itself now.', 'Feel the pressure?'],
      losing: ['Hmm. Time for something reckless.', 'Fine. Chaos it is.'],
      outOfBook: ['Enough theory. Let’s fight.', 'Off the map — my favourite place.'],
      engineWins: ['That was fun! Again?', 'Bunny 1, human 0.'],
      userWins: ['Well played! I demand a rematch.', 'You survived the bunny. Impressive.'],
      draw: ['A draw?! How dreadfully boring.'],
    },
  },
  stockfish: {
    id: 'stockfish',
    name: 'Stockfish',
    tagline: 'The benchmark engine',
    avatar: '🐟',
    accent: '#5ab0ff',
    engine: 'Stockfish 19 (lite NNUE)',
    lines: {
      greet: ['Stockfish 19 online. Evaluation pending.', 'Ready. Make your move.'],
      blunderFound: ['Inaccuracy detected. Exploiting.', 'Evaluation shifted. Thank you.'],
      mateFound: ['Forced mate found.', 'Mate sequence computed.'],
      winning: ['Decisive advantage. Converting.'],
      losing: ['Unexpected. Recalculating.'],
      outOfBook: ['Leaving theory. Search engaged.'],
      engineWins: ['1–0. As computed.', 'Game complete. Review recommended.'],
      userWins: ['Remarkable. Logging this game.'],
      draw: ['½–½. Accurate play from both sides.'],
    },
  },
  drawfish: {
    id: 'drawfish',
    name: 'DrawFish',
    tagline: 'Peace at all costs',
    avatar: '🐡',
    accent: '#5be3a4',
    engine: 'Stockfish 19 + Trollfish draw logic',
    lines: {
      greet: ['Peace was always an option. 🤝', 'Let’s agree to disagree… and draw.'],
      blunderFound: ['You blundered! …I’m still going for the draw.', 'I could punish that. But why?'],
      repetition: ['Again? Again. Again!', 'Repetition is the mother of learning.', 'Déjà vu, anyone?'],
      perpetual: ['Check. And check. And check…', 'Your king and I are best friends now.'],
      simplify: ['Let’s trade. Everything. Forever.', 'Fewer pieces, fewer problems.'],
      fortress: ['Opposite bishops. Nobody wins. Perfect.', 'Fortress mode: engaged.'],
      troll: ['I could win… but where’s the fun?', 'Just a little better. Not too much.'],
      losing: ['Draw? Draw? Draw please?', 'Stalemate would be lovely right now.'],
      outOfBook: ['Theory over. Peace talks begin.'],
      engineWins: ['Oops. I didn’t mean to win.', 'Wait, that wasn’t a draw!'],
      userWins: ['Noooo, I wanted a draw!', 'At least it’s over. Peacefully.'],
      draw: ['½–½. My favourite result. 😌', 'Another masterpiece of mutual respect.'],
    },
  },
};

export function line(persona: PersonaId, trigger: DialogueTrigger): string | null {
  const options = PROFILES[persona].lines[trigger];
  if (!options?.length) return null;
  return options[Math.floor(Math.random() * options.length)];
}

export function triggerForSignal(signal: PersonaSignal): DialogueTrigger | null {
  switch (signal.kind) {
    case 'blunderFound':
      return 'blunderFound';
    case 'mateFound':
      return 'mateFound';
    case 'winning':
      return 'winning';
    case 'losing':
      return 'losing';
    case 'outOfBook':
      return 'outOfBook';
  }
}

export function triggerForNote(note: MoveNote): DialogueTrigger | null {
  switch (note) {
    case 'sacrifice':
    case 'repetition':
    case 'perpetual':
    case 'simplify':
    case 'fortress':
    case 'troll':
      return note;
    default:
      return null;
  }
}

export function eloLabel(elo: number): string {
  if (elo >= 3000) return 'Full strength';
  if (elo >= 2600) return 'Super GM';
  if (elo >= 2400) return 'Grandmaster';
  if (elo >= 2200) return 'Master';
  if (elo >= 2000) return 'Expert';
  if (elo >= 1700) return 'Club player';
  if (elo >= 1400) return 'Intermediate';
  if (elo >= 1100) return 'Casual';
  return 'Beginner';
}
