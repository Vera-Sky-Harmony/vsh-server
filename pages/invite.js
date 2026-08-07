const LIFF_ID = "ここにLIFF_ID";

async function main() {

    await liff.init({
        liffId: LIFF_ID
    });

    if (!liff.isLoggedIn()) {
        liff.login();
        return;
    }

    const profile = await liff.getProfile();

    const response = await fetch("/api/introducer", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            userId: profile.userId,
            displayName: profile.displayName
        })
    });

    const result = await response.json();

    if (result.success) {
        location.href = "/pages/day0.html";
    } else {
        alert(result.message);
    }

}

main();
