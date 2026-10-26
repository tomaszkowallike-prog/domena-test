$(function () {
    function updateRegisterLink(price_list) {
        var s = $(price_list)
        var pkg = s.data('package');
        var opt = s.find(":selected");
        //var price = opt.data('price');
        var month = s.val();
        var link = s.closest('.row').find('.hosting-register-link-'+pkg);
        if (link.length > 0) {
            var href = $(link).attr('href');
            $(link).attr('href',  href.replace(/\/okres\/[0-9]+/, '/okres/'+month));
        }
    }
    $('.hosting-price-list').each(function (index, o) {
        updateRegisterLink(o);
        $(o).on('change', function(e) {
            updateRegisterLink(this);
        });
    })
});