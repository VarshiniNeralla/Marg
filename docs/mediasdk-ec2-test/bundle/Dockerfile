# Isolated MediaSDK 3.2.0 compatibility-test image (Ubuntu 22.04, the platform Insta360 documents).
# The SDK itself is NOT in the image: it is extracted from the unmodified official .deb onto the host and
# mounted read-only at /opt/MediaSDK-3.2.0-linux. Dependencies below are the .deb's own "Depends:" list plus
# Mesa software GL/Vulkan (CPU rendering) and python for output validation.
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      libx11-6 libgomp1 libxcb1 libpng16-16 libgl1 libglx0 libglvnd0 libegl1 libjpeg-turbo8 libxdmcp6 \
      libbsd0 libxau6 libmd0 libxext6 libvulkan1 libglfw3 libdc1394-dev libopenblas0 libtiff5 libfreetype6 \
      libharfbuzz0b libgtk-3-0 libcairo2 libgdk-pixbuf-2.0-0 libglib2.0-0 \
      mesa-vulkan-drivers libgl1-mesa-dri \
      python3 python3-pip time ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir numpy opencv-python-headless pillow
COPY validate.py /opt/validate.py
RUN useradd --system --uid 10001 --create-home tester
USER 10001
WORKDIR /tmp
