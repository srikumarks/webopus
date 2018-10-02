
# We assume that the emscripten sdk is installed and activated
# at ~/emsdk-portable. If not, change this definition. You
# will need the emscripten SDK to execute this build.
EMENV=~/emsdk-portable/emsdk_env.sh

# The URL from which to download the opus codec source.
LIBOPUS=https://archive.mozilla.org/pub/opus/opus-1.2.1.tar.gz

# libsamplerate does not have tagged releases. So we just pick master.
# As of this writing, the release is 1.9.0.
LIBSRCONV=https://github.com/erikd/libsamplerate/archive/master.zip

# The destination build directory under which all other sources
# and dependencies will be built.
DEST=build

# The directory in which to expand and build libsamplerate
SRCONV=$(DEST)/libsamplerate

# The directory in which to expand and build the opus codec.
OPUS=$(DEST)/libopus

# The Javascript minifier to use. You can change this to cat
# if you don't want to minify the javascript.
uglifyjs=uglifyjs

# The name of the final web worker product. The JS file will
# be $(lib).js
lib=webopus
libasmjs=$(lib).asm

# Various optimization and export settings needed to get emscripten
# to work on opus and libsamplerate.
EMCC_OPTS=-O2 --llvm-lto 3 -s NO_FILESYSTEM=1 --memory-init-file 0 \
		  -s EXPORTED_RUNTIME_METHODS="['setValue', 'getValue']" \
		  -s EXPORTED_FUNCTIONS="['_malloc', '_free', '_opus_strerror', '_opus_encoder_create', '_opus_encoder_destroy', '_opus_encode_float', '_opus_decoder_create', '_opus_decoder_destroy', '_opus_decode_float', '_src_strerror', '_src_new', '_src_delete', '_src_process_direct']"

all: $(OPUS) $(SRCONV) $(DEST) $(DEST)/$(lib).min.js.gz $(DEST)/$(libasmjs).min.js.gz

$(OPUS).tar.gz:
	wget $(LIBOPUS) -O $(OPUS).tar.gz
	
$(OPUS): $(OPUS).tar.gz
	cd $(DEST) && tar zxvf ../$(OPUS).tar.gz
	mv $(DEST)/opus-1.2.1 $(OPUS)
	cd $(OPUS) \
		&& source $(EMENV) \
		&& emconfigure ./configure --disable-extra-programs --disable-doc --disable-intrinsics \
		&& emmake make

$(SRCONV).zip:
	wget $(LIBSRCONV) -O $(SRCONV).zip

# 1. Expand the libsamplerate-master.zip into build/libsamplerate directory.
# 2. Create a build/libsamplerate/webopus directory as the installation target
# 3. Build and install only the libsamplerate.a and such library files into build/libsamplerate/webopus/lib
$(SRCONV): $(SRCONV).zip
	cd $(DEST) && unzip ../$(SRCONV).zip
	mv $(DEST)/libsamplerate-master $(SRCONV)
	cat $(SRCONV)/src/samplerate.c direct.c > /tmp/samplerate.c
	mv /tmp/samplerate.c $(SRCONV)/src/samplerate.c
	cd $(SRCONV) \
		&& source $(EMENV) \
		&& ./autogen.sh \
		&& mkdir $(lib) \
		&& emconfigure ./configure --prefix=`pwd`/$(lib)/\
		&& emmake make install-libLTLIBRARIES

$(DEST):
	mkdir -p $(DEST)

$(DEST)/$(lib).min.js.gz: $(DEST)/$(lib).min.js
	gzip -f -k $(DEST)/$(lib).min.js

$(DEST)/$(libasmjs).min.js.gz: $(DEST)/$(libasmjs).min.js
	gzip -f -k $(DEST)/$(libasmjs).min.js

$(DEST)/$(lib).min.js: $(DEST)/$(lib).js
	$(uglifyjs) $(DEST)/$(lib).js > $(DEST)/$(lib).min.js.tmp
	cat LICENSE_HEADER $(DEST)/$(lib).min.js.tmp > $(DEST)/$(lib).min.js
	rm $(DEST)/$(lib).min.js.tmp

$(DEST)/$(libasmjs).min.js: $(DEST)/$(libasmjs).js
	$(uglifyjs) $(DEST)/$(libasmjs).js > $(DEST)/$(libasmjs).min.js.tmp
	cat LICENSE_HEADER $(DEST)/$(libasmjs).min.js.tmp > $(DEST)/$(libasmjs).min.js
	rm $(DEST)/$(libasmjs).min.js.tmp

$(DEST)/$(lib).js: $(SRCONV) $(OPUS) \
			$(SRCONV)/$(lib)/lib/libsamplerate.a \
			$(OPUS)/.libs/libopus.a \
			opus_wrapper.js \
			src_wrapper.js \
			worker.js \
			pre.js post.js utils.js
	source $(EMENV) \
		&& emcc $(EMCC_OPTS) -s WASM=1 \
				$(OPUS)/.libs/libopus.a \
				$(SRCONV)/$(lib)/lib/libsamplerate.a \
				--pre-js pre.js \
				--post-js utils.js \
				--post-js opus_wrapper.js \
				--post-js src_wrapper.js \
				--post-js worker.js \
				--post-js post.js \
				-o $(DEST)/$(lib).js

$(DEST)/$(libasmjs).js: $(SRCONV) $(OPUS) \
			$(SRCONV)/$(lib)/lib/libsamplerate.a \
			$(OPUS)/.libs/libopus.a \
			opus_wrapper.js \
			src_wrapper.js \
			worker.js \
			pre.js post.js utils.js
	source $(EMENV) \
		&& emcc $(EMCC_OPTS) -s WASM=0 \
				$(OPUS)/.libs/libopus.a \
				$(SRCONV)/$(lib)/lib/libsamplerate.a \
				--pre-js pre.js \
				--post-js utils.js \
				--post-js opus_wrapper.js \
				--post-js src_wrapper.js \
				--post-js worker.js \
				--post-js post.js \
				-o $(DEST)/$(libasmjs).js

upload: $(DEST)/$(lib).min.js.gz
	s3cmd -P \
		--add-header="Content-Encoding: gzip" \
		--add-header="Cache-Control: max-age=1209600" \
		--mime-type="application/javascript" \
		put $(DEST)/$(lib).min.js.gz s3://sriku.org/lib/$(lib).min.js
	
test: $(DEST)/$(lib).js
	jest

clean:
	rm -rf $(DEST)/*





