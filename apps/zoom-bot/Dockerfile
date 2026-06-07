FROM ubuntu:24.04 AS base

SHELL ["/bin/bash", "-c"]

ENV project=meeting-sdk-linux-sample
ENV cwd=/tmp/$project

WORKDIR $cwd

ARG DEBIAN_FRONTEND=noninteractive

#  Install Dependencies
RUN apt-get update  \
    && apt-get install -y \
    build-essential \
    ca-certificates \
    cmake \
    curl \
    gdb \
    git \
    gfortran \
    libopencv-dev \
    libdbus-1-3 \
    libgbm1 \
    libgl1 \
    libglib2.0-0 \
    libglib2.0-dev \
    libssl-dev \
    libx11-dev \
    libx11-xcb1 \
    libxcb-image0 \
    libxcb-keysyms1 \
    libxcb-randr0 \
    libxcb-shape0 \
    libxcb-shm0 \
    libxcb-xfixes0 \
    libxcb-xtest0 \
    libgl1-mesa-dri \
    libxfixes3 \
    libssl-dev \
    linux-libc-dev \
    pciutils \
    pkgconf \
    tar \
    unzip \
    zip

# Install ALSA
RUN apt-get install -y libasound2t64 libasound2-plugins alsa alsa-utils alsa-oss

# Install Pulseaudio
RUN apt-get install -y  pulseaudio pulseaudio-utils

# Install Node.js 20 (NodeSource) — needed by the bridge in client/.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Install the SpacetimeDB CLI. The bridge shells out for create_room,
# add_transcript_chunk, and realtime operator reducers. Auth is token-based at
# container startup through SPACETIME_TOKEN.
RUN curl -fsSL https://install.spacetimedb.com | bash -s -- --yes \
    && ln -sf /root/.local/bin/spacetime /usr/local/bin/spacetime || true

FROM base AS deps

ENV TINI_VERSION=v0.19.0
# Pull the arch-specific tini so multi-arch images work. The upstream sample
# hardcoded the x86_64 binary, which breaks on linux/arm64 with a Rosetta
# error: "failed to open elf at /lib64/ld-linux-x86-64.so.2".
ARG TARGETARCH
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini-${TARGETARCH} /tini
RUN chmod +x /tini

WORKDIR /opt
RUN git clone --depth 1 https://github.com/Microsoft/vcpkg.git \
    && ./vcpkg/bootstrap-vcpkg.sh -disableMetrics \
    && ln -s /opt/vcpkg/vcpkg /usr/local/bin/vcpkg \
    && vcpkg install vcpkg-cmake

FROM deps AS build

WORKDIR $cwd

COPY client/package*.json ./client/
RUN npm --prefix=client ci --omit=dev --no-audit --no-fund

COPY . ./
RUN chmod +x bin/*.sh

ENTRYPOINT ["/tini", "--", "./bin/entry.sh"]
