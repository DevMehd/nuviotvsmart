// Fixed-width unsigned arithmetic shared with kernels.js. No DOM, exceptions,
// libc or hidden network calls. Arrays are bounded to 32768 items.
#include <stdint.h>
static uint32_t input[32768], output[32768];
extern "C" {
uint32_t* input_ptr() { return input; }
uint32_t* output_ptr() { return output; }
uint32_t run(uint32_t kernel, uint32_t n, uint32_t parameter) {
  if (n > 32768) return 0;
  uint32_t sum=0;
  for (uint32_t i=0;i<n;i++) {
    uint32_t v=input[i];
    if(kernel==0) { sum += 60+(v%180); output[i]=sum; }
    else if(kernel==1) { output[i]=((v & 15)>=parameter) ? ((v>>4)%10000)*3+(v%7) : 0; }
    else { uint32_t flags=0;
      // Classification of already-tokenized quality/language/codec flags.
      // Deliberately not a replacement benchmark for arbitrary addon regexes.
      if((v&3)==3)flags|=1; if((v&12)==8)flags|=2;
      if((v&48)==32)flags|=4; if((v&192)==128)flags|=8;
      if((v&768)==512)flags|=16; if((v&3072)==2048)flags|=32;
      output[i]=flags;
    }
  }
  return n;
}
}
