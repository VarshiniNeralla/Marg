package com.sitevision.fieldapp;

import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiNetworkSpecifier;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Bridges any Insta360 camera's OSC (X3, X4, X5, X6 and later; the model is read from /osc/info, never assumed) (Open Spherical Camera) HTTP API into a
 * single-shot "trigger capture, download the file" call from the web layer.
 *
 * The camera is its own WiFi access point at a fixed IP (192.168.42.1) with
 * no internet of its own. Per Google's documented pattern for exactly this
 * "secondary device on its own AP" scenario (developer.android.com/develop/
 * connectivity/wifi/wifi-bootstrap), we request it via WifiNetworkSpecifier
 * as a LOCAL-ONLY network (NET_CAPABILITY_INTERNET removed) so it becomes a
 * secondary, concurrent connection — the phone's normal WiFi/cellular route
 * to our own backend is left completely untouched. Only THIS plugin's HTTP
 * calls are bound (via Network#openConnection) to the camera's network;
 * nothing is bound process-wide, so the rest of the app keeps talking to the
 * backend at the same time.
 */
@CapacitorPlugin(
        name = "Insta360Camera",
        permissions = {
                @Permission(strings = { android.Manifest.permission.NEARBY_WIFI_DEVICES }, alias = "nearbyWifiDevices"),
                @Permission(strings = { android.Manifest.permission.ACCESS_FINE_LOCATION }, alias = "fineLocation")
        }
)
public class Insta360CameraPlugin extends Plugin {
    private static final String CAMERA_HOST = "192.168.42.1";
    private static final int HTTP_TIMEOUT_MS = 8000;
    // Poll twice a second (Insta360 recommends at most once a second for /osc/info; the status call is light) so the
    // photo is picked up within ~0.5 s of the camera finishing instead of up to a full second later.
    private static final int STATUS_POLL_INTERVAL_MS = 500;
    private static final int STATUS_POLL_MAX_ATTEMPTS = 60;
    private static final String TAG = "Insta360Camera";
    // The X3 can leave photo mode between shots (it answers camera.takePicture with HTTP 400
    // "disabledCommand: Currently camera is not working in image mode"). Before every shot we check the
    // capture mode and switch it back, and if the camera still refuses we switch and retry.
    private static final int MAX_CAPTURE_ATTEMPTS = 3;
    private static final long MODE_SETTLE_MS = 1500;
    // Give the camera time to finish writing/processing the previous raw frame before the next trigger.
    private static final long MIN_CAPTURE_GAP_MS = 2000;

    private ConnectivityManager connectivityManager;
    private volatile long lastCaptureFinishedAtMs = 0;
    private ConnectivityManager.NetworkCallback networkCallback;
    private volatile Network cameraNetwork;
    private volatile String cameraModel = "";

    @Override
    public void load() {
        connectivityManager = (ConnectivityManager) getContext()
                .getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
    }

    /** NEARBY_WIFI_DEVICES only exists on API 33+; below that, WifiNetworkSpecifier
     *  requests need ACCESS_FINE_LOCATION instead. */
    private String requiredPermissionAlias() {
        return android.os.Build.VERSION.SDK_INT >= 33 ? "nearbyWifiDevices" : "fineLocation";
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (readSsidTiers(call).isEmpty()) {
            call.reject("ssidPatterns (or ssidPattern) is required");
            return;
        }

        String alias = requiredPermissionAlias();
        if (getPermissionState(alias) != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "onWifiPermissionResult");
            return;
        }

        connectInternal(call);
    }

    @PermissionCallback
    private void onWifiPermissionResult(PluginCall call) {
        if (getPermissionState(requiredPermissionAlias()) != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("Permission required to connect to the camera's WiFi network was denied.");
            return;
        }
        connectInternal(call);
    }

    /** One SSID filter to try: PATTERN_PREFIX for a plain name prefix, PATTERN_ADVANCED_GLOB for a glob ("." = any char). */
    private static final class SsidTier {
        final String pattern;
        final int type;
        SsidTier(String pattern, int type) { this.pattern = pattern; this.type = type; }
    }

    /**
     * SSID filters to try, in order. The web layer passes `ssidPatterns` ([{pattern, mode: "prefix"|"glob"}]) so no
     * camera model is hard-coded here; the legacy single `ssidPattern` (a prefix) still works.
     */
    private java.util.List<SsidTier> readSsidTiers(PluginCall call) {
        java.util.List<SsidTier> tiers = new java.util.ArrayList<>();
        com.getcapacitor.JSArray arr = call.getArray("ssidPatterns");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String p = o.optString("pattern", "");
                if (p.isEmpty()) continue;
                boolean glob = "glob".equalsIgnoreCase(o.optString("mode", "prefix"));
                tiers.add(new SsidTier(p, glob ? android.os.PatternMatcher.PATTERN_ADVANCED_GLOB : android.os.PatternMatcher.PATTERN_PREFIX));
            }
        }
        String legacy = call.getString("ssidPattern");
        if (tiers.isEmpty() && legacy != null && !legacy.trim().isEmpty()) {
            tiers.add(new SsidTier(legacy, android.os.PatternMatcher.PATTERN_PREFIX));
        }
        return tiers;
    }

    private void connectInternal(PluginCall call) {
        String password = call.getString("password");

        if (cameraNetwork != null) {
            checkOscInfo(call);
            return;
        }

        java.util.List<SsidTier> tiers = readSsidTiers(call);
        final Handler mainHandler = new Handler(Looper.getMainLooper());
        final boolean[] settled = { false };
        requestCameraNetwork(call, tiers, 0, password, mainHandler, settled);

        // The framework has no built-in timeout for requestNetwork without a
        // duration overload on all supported API levels; enforce one here so
        // a call never hangs forever if the camera is unreachable. It spans ALL filters, so a camera whose
        // network name matches only a later (broader) filter still has time to be found.
        mainHandler.postDelayed(() -> {
            if (!settled[0]) {
                settled[0] = true;
                call.reject("Timed out waiting for the camera's WiFi network. The camera stops broadcasting its WiFi after a while: press its power button to wake it, then try again. Also check that the camera is on with its "
                        + "WiFi enabled and that the camera's WiFi password is correct.");
            }
        }, 15000L + 10000L * Math.max(0, tiers.size() - 1));
    }

    /** Requests the camera AP with tier `index`; when the system reports no match, falls through to the next filter. */
    private void requestCameraNetwork(PluginCall call, java.util.List<SsidTier> tiers, int index, String password,
                                      Handler mainHandler, boolean[] settled) {
        SsidTier tier = tiers.get(index);
        WifiNetworkSpecifier.Builder specifierBuilder = new WifiNetworkSpecifier.Builder()
                .setSsidPattern(new android.os.PatternMatcher(tier.pattern, tier.type));
        if (password != null && !password.isEmpty()) {
            specifierBuilder.setWpa2Passphrase(password);
        }

        NetworkRequest request = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .setNetworkSpecifier(specifierBuilder.build())
                .build();

        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                cameraNetwork = network;
                if (settled[0]) return;
                settled[0] = true;
                checkOscInfo(call);
            }

            @Override
            public void onUnavailable() {
                cameraNetwork = null;
                if (settled[0]) return;
                if (index + 1 < tiers.size()) {
                    Log.w(TAG, "no network matched filter '" + tier.pattern + "', trying the next filter");
                    try {
                        connectivityManager.unregisterNetworkCallback(this);
                    } catch (IllegalArgumentException ignored) {
                        // already unregistered
                    }
                    requestCameraNetwork(call, tiers, index + 1, password, mainHandler, settled);
                    return;
                }
                settled[0] = true;
                call.reject("Could not connect to the camera's WiFi network. Make sure the camera is powered on and its "
                        + "WiFi is enabled, and that the camera WiFi password is correct (newer cameras such as the X4 and "
                        + "X5 use their own password, shown in the camera's WiFi settings).");
            }

            @Override
            public void onLost(Network network) {
                if (network.equals(cameraNetwork)) {
                    cameraNetwork = null;
                }
            }
        };

        connectivityManager.requestNetwork(request, networkCallback);
    }

    private void checkOscInfo(PluginCall call) {
        new Thread(() -> {
            try {
                String body = httpGet("/osc/info");
                JSObject result = new JSObject();
                result.put("connected", true);
                result.put("ssid", "");
                // Identify the camera from its own answer (model-agnostic: X3, X4, X5, X6, whatever ships next).
                try {
                    JSONObject info = new JSONObject(body);
                    result.put("model", info.optString("model", ""));
                    result.put("firmwareVersion", info.optString("firmwareVersion", ""));
                    cameraModel = info.optString("model", "");
                    Log.i(TAG, "connected to camera model='" + cameraModel + "' firmware='"
                            + info.optString("firmwareVersion", "") + "'");
                } catch (Exception parseError) {
                    Log.w(TAG, "could not parse /osc/info: " + parseError.getMessage());
                }
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Connected to camera WiFi but /osc/info did not respond: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void capturePhoto(PluginCall call) {
        if (cameraNetwork == null) {
            call.reject("Not connected to the camera. Call connect() first.");
            return;
        }

        new Thread(() -> {
            try {
                final long tStart = System.currentTimeMillis();
                // Pace the shots, then make sure the camera is in photo mode BEFORE triggering.
                long sinceLast = System.currentTimeMillis() - lastCaptureFinishedAtMs;
                if (sinceLast < MIN_CAPTURE_GAP_MS) {
                    Thread.sleep(MIN_CAPTURE_GAP_MS - sinceLast);
                }
                final long tPaced = System.currentTimeMillis();
                ensureImageMode();
                final long tMode = System.currentTimeMillis();
                ensureRawPhotoOutput();
                ensureHdrOff();
                logCaptureOptions();
                final long tRaw = System.currentTimeMillis();

                // Trigger the still capture and wait for the file. If the camera still answers
                // "disabledCommand" (it is not in image mode), switch it back and try again.
                String fileUrl = null;
                IOException lastError = null;
                for (int attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS && fileUrl == null; attempt++) {
                    try {
                        fileUrl = takePictureAndWait();
                        if (fileUrl == null) {
                            break; // timed out waiting for the camera; reported below
                        }
                    } catch (IOException e) {
                        lastError = e;
                        if (!isModeError(e) || attempt == MAX_CAPTURE_ATTEMPTS) {
                            throw e;
                        }
                        Log.w(TAG, "takePicture refused because the camera is not in image mode (attempt "
                                + attempt + "/" + MAX_CAPTURE_ATTEMPTS + "): " + e.getMessage());
                        forceImageMode();
                    }
                }

                final long tShot = System.currentTimeMillis();
                if (fileUrl == null) {
                    call.reject("Timed out waiting for the camera to finish capturing.");
                    return;
                }

                // 3. Download the resulting file, bound to the camera's network.
                // The OSC spec's fileUrl is usually a full "http://192.168.42.1/..."
                // URL, but some firmware returns a bare path — normalise either form.
                String absoluteUrl = fileUrl.startsWith("http://") || fileUrl.startsWith("https://")
                        ? fileUrl
                        : "http://" + CAMERA_HOST + (fileUrl.startsWith("/") ? fileUrl : "/" + fileUrl);
                String fileName = absoluteUrl.substring(absoluteUrl.lastIndexOf('/') + 1);

                // NOTE (confirmed by directly downloading and inspecting a live capture):
                // camera.takePicture on this X3 returns a RAW, un-stitched, side-by-side
                // dual-fisheye frame (two full circular fisheye images, each ~5984x5984)
                // — NOT an in-camera-stitched equirectangular JPEG as an earlier version
                // of this comment assumed. It genuinely needs the backend's raw stitcher
                // (fisheye_stitch.py), so it must be renamed to .insp for that pipeline to
                // pick it up — the wavy/misaligned output seen after briefly removing this
                // rename traces to fisheye_stitch.py's own calibration/geometry handling
                // for this side-by-side layout, not to this routing decision.
                if (fileName.toLowerCase().endsWith(".jpg")) {
                    fileName = fileName.substring(0, fileName.length() - 4) + ".insp";
                }

                File outFile = new File(getContext().getCacheDir(), fileName);
                downloadToFile(absoluteUrl, outFile);
                lastCaptureFinishedAtMs = System.currentTimeMillis();
                final long tDone = lastCaptureFinishedAtMs;
                // Where the time goes, per step (ms): pacing wait, mode check, raw-output check, shutter+camera
                // processing (until the file is ready), file download.
                Log.i(TAG, "capture timing ms: pace=" + (tPaced - tStart) + " mode=" + (tMode - tPaced)
                        + " rawOpt=" + (tRaw - tMode) + " shutterAndProcessing=" + (tShot - tRaw)
                        + " download=" + (tDone - tShot) + " total=" + (tDone - tStart)
                        + " bytes=" + outFile.length());

                JSObject result = new JSObject();
                result.put("filePath", outFile.getAbsolutePath());
                result.put("fileName", fileName);
                result.put("model", cameraModel);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Capture failed: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        if (networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (IllegalArgumentException ignored) {
                // Already unregistered — nothing to do.
            }
            networkCallback = null;
        }
        cameraNetwork = null;
        call.resolve();
    }

    /** Reads the camera's current capture mode and options (for field troubleshooting over USB debugging). */
    @PluginMethod
    public void diagnose(PluginCall call) {
        if (cameraNetwork == null) {
            call.reject("Not connected to the camera. Call connect() first.");
            return;
        }
        new Thread(() -> {
            try {
                JSObject result = new JSObject();
                result.put("captureMode", String.valueOf(readCaptureMode()));
                try {
                    result.put("state", httpPost("/osc/state", "{}"));
                } catch (Exception e) {
                    result.put("state", "unavailable: " + e.getMessage());
                }
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Diagnose failed: " + e.getMessage(), e);
            }
        }).start();
    }

    // ── OSC helpers ──

    /** True when the camera refused the command because it is not in image (photo) mode. */
    private boolean isModeError(IOException e) {
        String m = e.getMessage();
        return m != null && (m.contains("disabledCommand") || m.contains("not working in image mode"));
    }

    /** Triggers camera.takePicture and polls until the file is ready. Returns the file URL, or null on timeout. */
    private String takePictureAndWait() throws Exception {
        // (camera.startSession is not implemented by the X3's OSC firmware — confirmed on-device via
        // HTTP 400 "unknownCommand" — and isn't needed for camera.takePicture, so it's skipped.)
        JSONObject started = new JSONObject(httpPost("/osc/commands/execute", "{\"name\":\"camera.takePicture\"}"));
        String commandId = started.getString("id");

        // Poll camera.commands.status until state is "done".
        for (int attempt = 0; attempt < STATUS_POLL_MAX_ATTEMPTS; attempt++) {
            JSONObject statusJson = new JSONObject(httpPost("/osc/commands/status", "{\"id\":\"" + commandId + "\"}"));
            String state = statusJson.getString("state");
            Log.i(TAG, "takePicture poll " + attempt + ": state=" + state + " completion=" + statusJson.opt("progress"));
            if ("done".equals(state)) {
                JSONObject results = statusJson.optJSONObject("results");
                return results != null ? results.optString("fileUrl", null) : null;
            }
            if ("error".equals(state)) {
                JSONObject error = statusJson.optJSONObject("error");
                String code = error != null ? error.optString("code", "") : "";
                String message = error != null ? error.optString("message", "unknown error") : "unknown error";
                throw new IOException("Camera reported a capture error: " + (code.isEmpty() ? "" : code + ": ") + message);
            }
            Thread.sleep(STATUS_POLL_INTERVAL_MS);
        }
        return null;
    }

    /** Runs an OSC command through /osc/commands/execute and returns the parsed response. */
    private JSONObject oscCommand(String name, String parametersJson) throws Exception {
        String body = "{\"name\":\"" + name + "\"" + (parametersJson != null ? ",\"parameters\":" + parametersJson : "") + "}";
        return new JSONObject(httpPost("/osc/commands/execute", body));
    }

    /**
     * The backend stitcher expects the camera's UN-stitched dual-fisheye frame. Newer cameras can stitch on the
     * device and, when they do, return a finished panorama that the fisheye stitcher would then wrongly process.
     * Insta360's OSC lists `photoStitching` ("none" | "ondevice") and `photoStitchingSupport`; when the camera
     * advertises "none", select it so every model hands over the same raw frame. Cameras without the option
     * (the X3) already return raw frames and are left untouched. Best effort: never blocks a capture.
     */
    private void ensureRawPhotoOutput() {
        try {
            JSONObject response = oscCommand("camera.getOptions",
                    "{\"optionNames\":[\"photoStitching\",\"photoStitchingSupport\"]}");
            JSONObject results = response.optJSONObject("results");
            JSONObject options = results != null ? results.optJSONObject("options") : null;
            if (options == null) {
                return;
            }
            String support = String.valueOf(options.opt("photoStitchingSupport"));
            if (!support.contains("none")) {
                return; // option not offered: this camera/firmware already returns the raw frame
            }
            if ("none".equalsIgnoreCase(options.optString("photoStitching", ""))) {
                return;
            }
            JSONObject set = oscCommand("camera.setOptions", "{\"options\":{\"photoStitching\":\"none\"}}");
            Log.i(TAG, "setOptions photoStitching=none -> " + set.optString("state"));
        } catch (Exception e) {
            Log.w(TAG, "could not check photoStitching, continuing: " + e.getMessage());
        }
    }

    /**
     * HDR makes the camera bracket three exposures: the shot takes several seconds longer (measured on an X5:
     * about 12.2 s with HDR on versus 8.6 s off) and the OSC answer then describes three originals rather than the
     * single raw frame the backend stitcher expects. Switch it off when the camera offers the option. Best effort.
     */
    private void ensureHdrOff() {
        try {
            JSONObject response = oscCommand("camera.getOptions", "{\"optionNames\":[\"hdr\"]}");
            JSONObject results = response.optJSONObject("results");
            JSONObject options = results != null ? results.optJSONObject("options") : null;
            if (options == null || !options.has("hdr")) {
                return; // this camera has no HDR option
            }
            if ("off".equalsIgnoreCase(options.optString("hdr", ""))) {
                return;
            }
            JSONObject set = oscCommand("camera.setOptions", "{\"options\":{\"hdr\":\"off\"}}");
            Log.i(TAG, "setOptions hdr=off -> " + set.optString("state"));
        } catch (Exception e) {
            Log.w(TAG, "could not check hdr, continuing: " + e.getMessage());
        }
    }

    /** Logs the options that decide how long a still takes (self-timer delay, HDR bracketing, stitching, exposure). */
    private void logCaptureOptions() {
        try {
            JSONObject r = oscCommand("camera.getOptions", "{\"optionNames\":[\"captureMode\",\"exposureDelay\",\"hdr\","
                    + "\"photoStitching\",\"exposureProgram\",\"iso\",\"shutterSpeed\",\"whiteBalance\"]}");
            JSONObject results = r.optJSONObject("results");
            Log.i(TAG, "capture options: " + (results != null ? results.optJSONObject("options") : r));
        } catch (Exception e) {
            Log.w(TAG, "could not read capture options: " + e.getMessage());
        }
    }

    /** The camera's current captureMode ("image", "video", ...), or null if it could not be read. */
    private String readCaptureMode() {
        try {
            JSONObject response = oscCommand("camera.getOptions", "{\"optionNames\":[\"captureMode\"]}");
            JSONObject results = response.optJSONObject("results");
            JSONObject options = results != null ? results.optJSONObject("options") : null;
            return options != null ? options.optString("captureMode", null) : null;
        } catch (Exception e) {
            Log.w(TAG, "could not read captureMode: " + e.getMessage());
            return null;
        }
    }

    /** Switches the camera to photo mode and gives it a moment to settle. */
    private void forceImageMode() throws Exception {
        JSONObject response = oscCommand("camera.setOptions", "{\"options\":{\"captureMode\":\"image\"}}");
        Log.i(TAG, "setOptions captureMode=image -> " + response.optString("state"));
        Thread.sleep(MODE_SETTLE_MS);
    }

    /** Makes sure the camera is in photo mode before a shot; switches it back if it has drifted. */
    private void ensureImageMode() throws Exception {
        String mode = readCaptureMode();
        if ("image".equalsIgnoreCase(mode)) {
            return;
        }
        Log.w(TAG, "camera captureMode is '" + mode + "', switching to image mode");
        try {
            forceImageMode();
        } catch (IOException e) {
            if (mode != null) {
                throw e; // we know it is in the wrong mode and could not change it
            }
            // Mode unreadable AND setOptions refused: this firmware may not expose it; try the shot anyway.
            Log.w(TAG, "setOptions captureMode unavailable, continuing: " + e.getMessage());
            return;
        }
        String after = readCaptureMode();
        if (after != null && !"image".equalsIgnoreCase(after)) {
            throw new IOException("The camera is in '" + after + "' mode and did not switch back to photo mode. "
                    + "Switch it to photo mode on the camera, then try again.");
        }
    }

    // ── HTTP helpers, all bound to cameraNetwork so the backend connection is untouched ──

    private String httpGet(String path) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) cameraNetwork.openConnection(new URL("http://" + CAMERA_HOST + path));
        conn.setConnectTimeout(HTTP_TIMEOUT_MS);
        conn.setReadTimeout(HTTP_TIMEOUT_MS);
        conn.setRequestMethod("GET");
        applyOscHeaders(conn);
        try {
            return readBody(conn);
        } finally {
            conn.disconnect();
        }
    }

    private String httpPost(String path, String jsonBody) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) cameraNetwork.openConnection(new URL("http://" + CAMERA_HOST + path));
        conn.setConnectTimeout(HTTP_TIMEOUT_MS);
        conn.setReadTimeout(HTTP_TIMEOUT_MS);
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        applyOscHeaders(conn);
        conn.setDoOutput(true);
        byte[] payload = jsonBody.getBytes("UTF-8");
        try (OutputStream os = conn.getOutputStream()) {
            os.write(payload);
        }
        try {
            return readBody(conn);
        } finally {
            conn.disconnect();
        }
    }

    /** Headers Insta360's OSC documentation lists for every request; older firmware ignores them, newer requires them. */
    private void applyOscHeaders(HttpURLConnection conn) {
        conn.setRequestProperty("Accept", "application/json");
        conn.setRequestProperty("X-XSRF-Protected", "1");
    }

    private void downloadToFile(String url, File outFile) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) cameraNetwork.openConnection(new URL(url));
        conn.setConnectTimeout(HTTP_TIMEOUT_MS);
        conn.setReadTimeout(20000);
        conn.setRequestMethod("GET");
        try (InputStream in = conn.getInputStream();
             FileOutputStream out = new FileOutputStream(outFile)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        } finally {
            conn.disconnect();
        }
    }

    private String readBody(HttpURLConnection conn) throws IOException {
        int status = conn.getResponseCode();
        InputStream stream = (status >= 200 && status < 300) ? conn.getInputStream() : conn.getErrorStream();
        if (stream == null) {
            throw new IOException("HTTP " + status + " with no response body");
        }
        StringBuilder sb = new StringBuilder();
        try (InputStream in = stream) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) != -1) {
                sb.append(new String(buffer, 0, read, "UTF-8"));
            }
        }
        if (status < 200 || status >= 300) {
            throw new IOException("HTTP " + status + ": " + sb);
        }
        return sb.toString();
    }
}
