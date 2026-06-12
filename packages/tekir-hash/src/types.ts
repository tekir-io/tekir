export type BcryptOptions = {
  rounds?: number;
};

export type Argon2Options = {
  memoryCost?: number;
  timeCost?: number;
};

export type ScryptOptions = {
  N?: number;
  r?: number;
  p?: number;
  keylen?: number;
};

export type DriverName = "bcrypt" | "argon2" | "scrypt";

export type HashConfig = {
  default?: DriverName;
  bcrypt?: BcryptOptions;
  argon2?: Argon2Options;
  scrypt?: ScryptOptions;
};

export interface HashDriver {
  make(value: string): Promise<string>;
  verify(value: string, hash: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
}
