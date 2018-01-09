
// This malloc/free creates a typed-array view of a slice of
// emscripten's heap.
function ta_malloc(n, Type) {
    var ptr = Module._malloc(n * Type.BYTES_PER_ELEMENT);
    var arr = new Type(Module.HEAPU8.buffer, ptr, n);
    arr._emptr = ptr;
    return arr;
}

function ta_free(arr) {
    Module._free(arr._emptr);
}


