export type GoogleReminderSettings = {
  mode: "none" | "default" | "custom";
  overrides: { method: "popup" | "email"; minutes: number }[];
};
export const newReminderSettings = (): GoogleReminderSettings => ({
  mode: "none",
  overrides: [],
});
