import { useMemo } from 'react';

const VERSION = 5;
const SIZE = 17 + VERSION * 4; // 37
const DATA_CODEWORDS = 108;
const ECC_CODEWORDS = 26;

function gfMultiply(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    if (((y >>> i) & 1) !== 0) z ^= x;
  }
  return z & 0xff;
}

function reedSolomonDivisor(degree: number) {
  const result = Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]) {
  const result = Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    for (let i = 0; i < divisor.length; i += 1) {
      result[i] ^= gfMultiply(divisor[i], factor);
    }
  }
  return result;
}

function encodeData(value: string) {
  const bytes = Array.from(new TextEncoder().encode(value));
  // Version 5-L byte mode: 108 data codewords. After mode/count bits,
  // 106 UTF-8 bytes fit safely.
  if (bytes.length > 106) throw new Error('QR payload is too long');

  const bits: number[] = [];
  const addBits = (number: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((number >>> i) & 1);
  };

  addBits(0b0100, 4); // byte mode
  addBits(bytes.length, 8);
  bytes.forEach((byte) => addBits(byte, 8));

  const capacity = DATA_CODEWORDS * 8;
  const terminator = Math.min(4, capacity - bits.length);
  for (let i = 0; i < terminator; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  let pad = 0;
  while (codewords.length < DATA_CODEWORDS) {
    codewords.push(pad % 2 === 0 ? 0xec : 0x11);
    pad += 1;
  }
  return codewords;
}

function makeMatrix(value: string) {
  const modules = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
  const functions = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));

  const setFunction = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    modules[y][x] = dark;
    functions[y][x] = true;
  };

  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(cx + dx, cy + dy, distance !== 2 && distance !== 4);
      }
    }
  };

  drawFinder(3, 3);
  drawFinder(SIZE - 4, 3);
  drawFinder(3, SIZE - 4);

  for (let i = 8; i < SIZE - 8; i += 1) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }

  // Version 5 alignment pattern positions are [6, 30]. The first three
  // combinations overlap finder patterns, leaving only the bottom-right one.
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunction(30 + dx, 30 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // Format bits: error correction L (01), mask 0.
  const formatData = 1 << 3;
  let remainder = formatData;
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537);
  const formatBits = ((formatData << 10) | remainder) ^ 0x5412;
  const formatBit = (index: number) => ((formatBits >>> index) & 1) !== 0;

  for (let i = 0; i <= 5; i += 1) setFunction(8, i, formatBit(i));
  setFunction(8, 7, formatBit(6));
  setFunction(8, 8, formatBit(7));
  setFunction(7, 8, formatBit(8));
  for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, formatBit(i));
  for (let i = 0; i < 8; i += 1) setFunction(SIZE - 1 - i, 8, formatBit(i));
  for (let i = 8; i < 15; i += 1) setFunction(8, SIZE - 15 + i, formatBit(i));
  setFunction(8, SIZE - 8, true); // dark module

  const data = encodeData(value);
  const ecc = reedSolomonRemainder(data, reedSolomonDivisor(ECC_CODEWORDS));
  const codewords = [...data, ...ecc];
  const dataBits: number[] = [];
  codewords.forEach((byte) => {
    for (let i = 7; i >= 0; i -= 1) dataBits.push((byte >>> i) & 1);
  });

  let bitIndex = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < SIZE; vert += 1) {
      const y = upward ? SIZE - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        if (functions[y][x]) continue;
        let dark = bitIndex < dataBits.length ? dataBits[bitIndex] !== 0 : false;
        bitIndex += 1;
        // Mask pattern 0.
        if ((x + y) % 2 === 0) dark = !dark;
        modules[y][x] = dark;
      }
    }
  }

  return modules;
}

export function RewardQrCode({ value, size = 196, label = 'QR de canje DadoFit' }: { value: string; size?: number; label?: string }) {
  const matrix = useMemo(() => {
    try { return makeMatrix(value); } catch { return null; }
  }, [value]);

  if (!matrix) {
    return <div className="reward-qr-fallback-v152">QR no disponible. Usa la referencia DadoFit.</div>;
  }

  const quiet = 4;
  const viewBox = SIZE + quiet * 2;
  return <svg
    className="reward-qr-v152"
    width={size}
    height={size}
    viewBox={`0 0 ${viewBox} ${viewBox}`}
    role="img"
    aria-label={label}
    shapeRendering="crispEdges"
  >
    <rect width={viewBox} height={viewBox} fill="#fff"/>
    {matrix.flatMap((row, y) => row.map((dark, x) => dark ? <rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width="1" height="1" fill="#111827"/> : null))}
  </svg>;
}
