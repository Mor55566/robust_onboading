export function t(
  template: string,
  vars: Record<string, string | number>,
) {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
