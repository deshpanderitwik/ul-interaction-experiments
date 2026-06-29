// Setting descriptors. An experiment declares a schema (a map of key → control)
// and the host renders the panel from it. Slider only for now; toggle/select/
// button slot in here later, and ValuesOf maps each control type to its value.

export type SliderSetting = {
  type: 'slider';
  label: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  default: number;
};

export type SelectOption = { label: string; value: number };

export type SelectSetting = {
  type: 'select';
  label: string;
  options: readonly SelectOption[];
  default: number;
};

// On/off switch. Stored as a number (0 = off, 1 = on) so the values map stays
// uniformly numeric.
export type ToggleSetting = {
  type: 'toggle';
  label: string;
  default: number;
};

export type Setting = SliderSetting | SelectSetting | ToggleSetting;

export type Schema = Record<string, Setting>;

// The values object an experiment reads back. Every control currently yields a
// number; when non-numeric controls land, switch this to map by `type`.
export type ValuesOf<S extends Schema> = {
  [K in keyof S]: number;
};
