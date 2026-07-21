package com.sitevision.fieldapp;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

/**
 * The WebView's getUserMedia() (camera capture) request only reaches the
 * browser layer by default — Android's OWN runtime permission (and its
 * system "Allow camera access?" dialog) is a separate gate that Capacitor's
 * BridgeActivity does not wire up on its own. Without this, camera capture
 * fails immediately with a permission-denied error, before Android ever
 * offers to ask the user.
 */
public class MainActivity extends BridgeActivity {
    private static final int CAMERA_PERMISSION_REQUEST_CODE = 1001;
    private PermissionRequest pendingWebViewPermissionRequest;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        this.bridge.getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Only the camera resource is relevant to this app's capture flow.
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                        == PackageManager.PERMISSION_GRANTED) {
                    runOnUiThread(() -> request.grant(request.getResources()));
                    return;
                }
                pendingWebViewPermissionRequest = request;
                ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[] { Manifest.permission.CAMERA },
                        CAMERA_PERMISSION_REQUEST_CODE
                );
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_PERMISSION_REQUEST_CODE || pendingWebViewPermissionRequest == null) {
            return;
        }
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            pendingWebViewPermissionRequest.grant(pendingWebViewPermissionRequest.getResources());
        } else {
            pendingWebViewPermissionRequest.deny();
        }
        pendingWebViewPermissionRequest = null;
    }
}
