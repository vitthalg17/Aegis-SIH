export const FLAG = {
  BOOT: 0x0001,
  SENSOR_FAIL: 0x0002,
  NO_TIME: 0x0004,
  CLOCK_SET: 0x0008,
  MOTION: 0x0010,
  SHOCK: 0x0020,
  TEMP_MISMATCH: 0x0040,
  SENSOR_CHANGED: 0x0080,
  UNSIGNED: 0x0100,
  RTC_FAIL: 0x0200,
  MPU_FAIL: 0x0400,
} as const;

export const has = (flags: number, bit: number) => (flags & bit) !== 0;
