import robotSvg from './robot.svg';
import brainSvg from './brain.svg';
import lightbulbSvg from './lightbulb.svg';
import lightningSvg from './lightning.svg';
import analystSvg from './analyst.svg';
import creatorSvg from './creator.svg';
import marketingSvg from './marketing.svg';
import businessSvg from './business.svg';
import programmerSvg from './programmer.svg';
import engineerSvg from './engineer.svg';
import securitySvg from './security.svg';
import dataSvg from './data.svg';
import personSvg from './person.svg';
import educatorSvg from './educator.svg';
import translatorSvg from './translator.svg';
import designerSvg from './designer.svg';

export const PRESET_AVATARS: Record<string, string> = {
  robot: robotSvg,
  brain: brainSvg,
  lightbulb: lightbulbSvg,
  lightning: lightningSvg,
  analyst: analystSvg,
  creator: creatorSvg,
  marketing: marketingSvg,
  business: businessSvg,
  programmer: programmerSvg,
  engineer: engineerSvg,
  security: securitySvg,
  data: dataSvg,
  person: personSvg,
  educator: educatorSvg,
  translator: translatorSvg,
  designer: designerSvg,
};

export const AVATAR_CATEGORIES = [
  { id: 'general', presets: ['robot', 'brain', 'lightbulb', 'lightning'] },
  { id: 'business', presets: ['analyst', 'creator', 'marketing', 'business'] },
  { id: 'tech', presets: ['programmer', 'engineer', 'security', 'data'] },
  { id: 'personal', presets: ['person', 'educator', 'translator', 'designer'] },
] as const;
