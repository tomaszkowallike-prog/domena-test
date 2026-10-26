function setCookie(name, value, expire) {
    document.cookie = name + "=" + escape(value) + ((expire == null) ? "" : ("; expires=" + expire.toGMTString()));
}
function checkCookie(name) {
    if (document.cookie != "") {
        var toCookie = document.cookie.split("; ");
        for (i = 0; i < toCookie.length; i++) {
            var CookieName = toCookie[i].split("=")[0];
            var CookieValue = toCookie[i].split("=")[1];
            if (CookieName == name)
                return unescape(CookieValue);
        }
    }
}
function removeCookieAlert() {
    var CookieAlert = document.getElementById('CookieAlert');
    document.body.removeChild(CookieAlert);
    var expire = new Date();
    expire.setMonth(expire.getMonth() + 1);
    setCookie('agreeCookies', 'yes', expire);
}
window.onload = (function() {
    var CookieAlert = document.createElement('div');
    var style = 'background-color: rgba(0,0,0,0.6);position: fixed;bottom: 0px;left: 0px;right: 0px;text-align: center;width: 100%;z-index: 99999;color: #FFF;padding: 1% 5%;font-family: Arial;font-size: 12px;';
    var html = '<div class="d-inline-block"><strong>Uwaga!</strong> Strona korzysta z plików cookies. Odwiedzając nasz serwis zgadzasz się na ich przyjmowanie. Szczegółowe informacje w <a class="font-weight-bold text-white" href="/polityka-prywatnosci">Polityce Prywatności</a></div><a class="float-right font-weight-bold text-white" href="#" onclick="removeCookieAlert()">Zamknij</a>';
    CookieAlert.setAttribute('id', 'CookieAlert');
    CookieAlert.setAttribute('style', style);
    CookieAlert.innerHTML = html;
    if (checkCookie('agreeCookies') != 'yes') {
        document.body.appendChild(CookieAlert);
    }
});