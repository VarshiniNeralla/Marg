package com.sitevision.fieldapp;

import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiNetworkSpecifier;
import android.os.Handler;
import android.os.Looper;

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
 * Bridges the Insta360 X3's OSC (Open Spherical Camera) HTTP API into a
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
    private static final int STATUS_POLL_INTERVAL_MS = 1000;
    private static final int STATUS_POLL_MAX_ATTEMPTS = 20;

    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private volatile Network cameraNetwork;

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
        String ssidPattern = call.getString("ssidPattern");
        if (ssidPattern == null || ssidPattern.trim().isEmpty()) {
            call.reject("ssidPattern is required");
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

    private void connectInternal(PluginCall call) {
        String ssidPattern = call.getString("ssidPattern");
        String password = call.getString("password");

        if (cameraNetwork != null) {
            checkOscInfo(call);
            return;
        }

        WifiNetworkSpecifier.Builder specifierBuilder = new WifiNetworkSpecifier.Builder()
                .setSsidPattern(new android.os.PatternMatcher(ssidPattern, android.os.PatternMatcher.PATTERN_PREFIX));
        if (password != null && !password.isEmpty()) {
            specifierBuilder.setWpa2Passphrase(password);
        }

        NetworkRequest request = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .setNetworkSpecifier(specifierBuilder.build())
                .build();

        final Handler mainHandler = new Handler(Looper.getMainLooper());
        final boolean[] settled = { false };

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
                settled[0] = true;
                call.reject("Could not connect to the camera's WiFi network. Make sure the camera is powered on and its WiFi is enabled.");
            }

            @Override
            public void onLost(Network network) {
                if (network.equals(cameraNetwork)) {
                    cameraNetwork = null;
                }
            }
        };

        connectivityManager.requestNetwork(request, networkCallback);

        // The framework has no built-in timeout for requestNetwork without a
        // duration overload on all supported API levels; enforce one here so
        // a call never hangs forever if the camera is unreachable.
        mainHandler.postDelayed(() -> {
            if (!settled[0]) {
                settled[0] = true;
                call.reject("Timed out waiting for the camera's WiFi network.");
            }
        }, 15000);
    }

    private void checkOscInfo(PluginCall call) {
        new Thread(() -> {
            try {
                String body = httpGet("/osc/info");
                JSObject result = new JSObject();
                result.put("connected", true);
                result.put("ssid", "");
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
                // Trigger the still capture — returns an in-progress command id.
                // (camera.startSession is not implemented by the X3's OSC firmware —
                // confirmed on-device via HTTP 400 "unknownCommand" — and isn't
                // needed for camera.takePicture, so it's skipped entirely.)
                String takePictureResponse = httpPost("/osc/commands/execute", "{\"name\":\"camera.takePicture\"}");
                JSONObject takePictureJson = new JSONObject(takePictureResponse);
                String commandId = takePictureJson.getString("id");

                // 2. Poll camera.commands.status until state is "done".
                String fileUrl = null;
                for (int attempt = 0; attempt < STATUS_POLL_MAX_ATTEMPTS; attempt++) {
                    String statusResponse = httpPost("/osc/commands/status",
                            "{\"id\":\"" + commandId + "\"}");
                    JSONObject statusJson = new JSONObject(statusResponse);
                    String state = statusJson.getString("state");

                    if ("done".equals(state)) {
                        JSONObject results = statusJson.optJSONObject("results");
                        fileUrl = results != null ? results.optString("fileUrl", null) : null;
                        break;
                    }
                    if ("error".equals(state)) {
                        JSONObject error = statusJson.optJSONObject("error");
                        String message = error != null ? error.optString("message", "unknown error") : "unknown error";
                        throw new IOException("Camera reported a capture error: " + message);
                    }
                    Thread.sleep(STATUS_POLL_INTERVAL_MS);
                }

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
                
                // Force raw dual-fisheye extension so the backend knows to stitch it
                if (fileName.toLowerCase().endsWith(".jpg")) {
                    fileName = fileName.substring(0, fileName.length() - 4) + ".insp";
                }
                
                File outFile = new File(getContext().getCacheDir(), fileName);
                downloadToFile(absoluteUrl, outFile);

                JSObject result = new JSObject();
                result.put("filePath", outFile.getAbsolutePath());
                result.put("fileName", fileName);
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

    // ── HTTP helpers, all bound to cameraNetwork so the backend connection is untouched ──

    private String httpGet(String path) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) cameraNetwork.openConnection(new URL("http://" + CAMERA_HOST + path));
        conn.setConnectTimeout(HTTP_TIMEOUT_MS);
        conn.setReadTimeout(HTTP_TIMEOUT_MS);
        conn.setRequestMethod("GET");
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
