#!/usr/bin/env bash
set -euo pipefail

# directory for CMake output
BUILD=build

# directory for application output
mkdir -p out

setup-pulseaudio() {
  # Enable dbus
  if [[  ! -d /var/run/dbus ]]; then
    mkdir -p /var/run/dbus
    dbus-uuidgen > /var/lib/dbus/machine-id
    dbus-daemon --config-file=/usr/share/dbus-1/system.conf --print-address
  fi

  usermod -G pulse-access,audio root

  # Cleanup to be "stateless" on startup, otherwise pulseaudio daemon can't start
  rm -rf /var/run/pulse /var/lib/pulse /root/.config/pulse/
  mkdir -p ~/.config/pulse/ && cp -r /etc/pulse/* "$_"

  pulseaudio -D --exit-idle-time=-1 --system --disallow-exit

  # Create a virtual speaker output
  pactl load-module module-null-sink sink_name=SpeakerOutput
  pactl set-default-sink SpeakerOutput
  pactl set-default-source SpeakerOutput.monitor

  # Make config file
  echo -e "[General]\nsystem.audio.type=default" > ~/.config/zoomus.conf
}

setup-spacetime-auth() {
  if [[ -z "${SPACETIME_TOKEN:-}" ]]; then
    echo "fatal: SPACETIME_TOKEN is not set"
    exit 1
  fi

  export SPACETIME_ROOT_DIR="${SPACETIME_ROOT_DIR:-/tmp/spacetime}"
  mkdir -p "$SPACETIME_ROOT_DIR"
  spacetime --root-dir "$SPACETIME_ROOT_DIR" login --token "$SPACETIME_TOKEN" >/dev/null || {
    echo "fatal: spacetime login --token failed"
    exit 1
  }
}

build() {
  # Generate config.toml from env vars before anything else reads it.
  bin/gen-config.sh

  # Configure CMake if this is the first run.
  [[ ! -d "$BUILD" ]] && {
    cmake -B "$BUILD" -S . --preset debug || exit;
  }

  # Install Node bridge deps if they aren't present (volume-mounted source means
  # node_modules can be missing even when the C++ build dir is cached).
  [[ ! -d client/node_modules ]] && {
    npm --prefix=client install --no-audit --no-fund
  }

  # Rename the shared library
  LIB="lib/zoomsdk/libmeetingsdk.so"
  [[ ! -f "${LIB}.1" ]] && cp "$LIB"{,.1}

  # Set up and start pulseaudio
  setup-pulseaudio &> /dev/null || exit;

  # Build the C++ binary
  cmake --build "$BUILD"
}

run() {
  export QT_LOGGING_RULES="*.debug=false;*.warning=false"
  setup-spacetime-auth

  # Make sure stale socket state from the upstream sample cannot interfere.
  rm -f /tmp/meeting.sock

  # Start the Node bridge first so it can wait on out/mixed.pcm.
  ( cd client && node src/index.js ) &
  BRIDGE_PID=$!

  # Trap so we kill the bridge when the bot exits.
  trap 'kill $BRIDGE_PID 2>/dev/null || true' EXIT

  # C++ bot — RawAudio (no --transcribe) writes mixed PCM to out/mixed.pcm.
  # The Node bridge tails this file and streams it to OpenAI Realtime. We avoid
  # --transcribe because it triggers a post-authorize segfault in the SDK
  # that we can't debug inside the closed-source libmeetingsdk.so.
  mkdir -p out
  # Truncate any previous capture so the bridge's offset starts at zero.
  : > out/mixed.pcm
  ./"$BUILD"/zoomsdk RawAudio -f mixed.pcm -d out
}

build && run

exit $?
