const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isValidName = (name: string): boolean =>
  name.length <= 64 && namePattern.test(name);

export const validateName = (name: string): void => {
  if (!isValidName(name)) {
    throw new Error(`invalid name '${name}' - use up to 64 kebab-case characters with single dashes`);
  }
};
