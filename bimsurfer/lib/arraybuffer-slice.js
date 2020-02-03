// https://github.com/ttaubert/node-arraybuffer-slice
// (c) 2014 Tim Taubert <tim@timtaubert.de>
// arraybuffer-slice may be freely distributed under the MIT license.

(function (undefined) {
  "use strict";

  function clamp(val, length) {
    val = (val|0) || 0;

    if (val < 0) {
      return Math.max(val + length, 0);
    }

    return Math.min(val, length);
  }

  if (!ArrayBuffer.prototype.slice) {
    ArrayBuffer.prototype.slice = function (from, to) {
      var length = this.byteLength;
      var begin = clamp(from, length);
      var end = length;

      if (to !== undefined) {
        end = clamp(to, length);
      }

      if (begin > end) {
        return new ArrayBuffer(0);
      }

      var num = end - begin;
      var target = new ArrayBuffer(num);
      var targetArray = new Uint8Array(target);

      var sourceArray = new Uint8Array(this, begin, num);
      targetArray.set(sourceArray);

      return target;
    };
  }
})();


if (typeof Int8Array !== 'undefined') {
    if (!Int8Array.prototype.fill) Int8Array.prototype.fill = Array.prototype.fill;
    if (!Int8Array.prototype.slice) Int8Array.prototype.slice = Array.prototype.slice;
}
if (typeof Uint8Array !== 'undefined') {
    if (!Uint8Array.prototype.fill) Uint8Array.prototype.fill = Array.prototype.fill;
    if (!Uint8Array.prototype.slice) Uint8Array.prototype.slice = Array.prototype.slice;
}
if (typeof Uint8ClampedArray !== 'undefined') {
    if (!Uint8ClampedArray.prototype.fill) Uint8ClampedArray.prototype.fill = Array.prototype.fill;
    if (!Uint8ClampedArray.prototype.slice) Uint8ClampedArray.prototype.slice = Array.prototype.slice;
}
if (typeof Int16Array !== 'undefined') {
    if (!Int16Array.prototype.fill) Int16Array.prototype.fill = Array.prototype.fill;
    if (!Int16Array.prototype.slice) Int16Array.prototype.slice = Array.prototype.slice;
}
if (typeof Uint16Array !== 'undefined') {
    if (!Uint16Array.prototype.fill) Uint16Array.prototype.fill = Array.prototype.fill;
    if (!Uint16Array.prototype.slice) Uint16Array.prototype.slice = Array.prototype.slice;
}
if (typeof Int32Array !== 'undefined') {
    if (!Int32Array.prototype.fill) Int32Array.prototype.fill = Array.prototype.fill;
    if (!Int32Array.prototype.slice) Int32Array.prototype.slice = Array.prototype.slice;
}
if (typeof Uint32Array !== 'undefined') {
    if (!Uint32Array.prototype.fill) Uint32Array.prototype.fill = Array.prototype.fill;
    if (!Uint32Array.prototype.slice) Uint32Array.prototype.slice = Array.prototype.slice;
}
if (typeof Float32Array !== 'undefined') {
    if (!Float32Array.prototype.fill) Float32Array.prototype.fill = Array.prototype.fill;
    if (!Float32Array.prototype.slice) Float32Array.prototype.slice = Array.prototype.slice;
}
if (typeof Float64Array !== 'undefined') {
    if (!Float64Array.prototype.fill) Float64Array.prototype.fill = Array.prototype.fill;
    if (!Float64Array.prototype.slice) Float64Array.prototype.slice = Array.prototype.slice;
}
if (typeof TypedArray !== 'undefined') {
    if (!TypedArray.prototype.fill) TypedArray.prototype.fill = Array.prototype.fill;
    if (!TypedArray.prototype.slice) TypedArray.prototype.slice = Array.prototype.slice;
}