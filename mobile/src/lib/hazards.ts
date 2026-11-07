import type { ComponentProps } from 'react';
import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export type Hazard = 'tornado' | 'flood' | 'hurricane' | 'wildfire' | 'earthquake';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type HazardInfo = {
  id: Hazard;
  name: string;
  icon: IconName;
  /** What a good safe room looks like for this hazard, shown while editing. */
  guidance: string;
  /** Quick picks offered in the editor. */
  suggestions: string[];
};

export const HAZARDS: HazardInfo[] = [
  {
    id: 'tornado',
    name: 'Tornado',
    icon: 'weather-tornado',
    guidance: 'Lowest floor, interior room, no windows. A basement or storm shelter is best.',
    suggestions: ['Basement', 'Storm shelter', 'Interior closet', 'Interior bathroom'],
  },
  {
    id: 'flood',
    name: 'Flood',
    icon: 'home-flood',
    guidance: 'Highest floor you can reach, ideally with roof access. Avoid closed attics with no exit.',
    suggestions: ['Second floor bedroom', 'Attic with roof hatch', 'Upstairs landing'],
  },
  {
    id: 'hurricane',
    name: 'Hurricane',
    icon: 'weather-hurricane',
    guidance: 'Small interior room away from windows on the lowest floor that will not flood.',
    suggestions: ['Interior hallway', 'Interior closet', 'Safe room'],
  },
  {
    id: 'wildfire',
    name: 'Wildfire',
    icon: 'fire',
    guidance: 'Plan your exit, not a room. Note the door you will leave from and where you will meet.',
    suggestions: ['Garage exit', 'Back door to alley', 'Front door to street'],
  },
  {
    id: 'earthquake',
    name: 'Earthquake',
    icon: 'home-alert',
    guidance: 'Under sturdy furniture or against an interior wall, away from glass and tall shelves.',
    suggestions: ['Under dining table', 'Interior hallway wall', 'Doorframe in hallway'],
  },
];

export const hazardById = (id: Hazard) => HAZARDS.find((h) => h.id === id)!;
