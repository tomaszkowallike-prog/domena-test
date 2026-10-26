(function () {
    'use strict';
    var updatePrice = function() {
        if (typeof VPS === 'undefined') {
            return;
        }
        var markups_settings = VPS.markups;
        var price = 0;
        $('.vpsslider').each(function (i, slider) {
            var jqSlider = $(slider);

            var steps = jqSlider.data('sliderSteps');
            var dest = jqSlider.data('sliderDest');
            var prices = jqSlider.data('sliderPrice');

            var slider_index = steps.indexOf(Number($('#'+dest).val()));
            if (typeof prices === 'object' && slider_index in prices) {
                price += prices[slider_index];
            }

        });

        var markup =100;

        // bckup: 30 dolarów za 50GB

        if($('input[type=radio][name=vps_backup]:checked').val() === '1') {
            var hdd = Number($('#vps-disk').val());
            price = price + hdd / VPS.params.backup.price_per_gb * VPS.params.backup.prices[1] //backup
        }

        price = price * VPS.dollar; //kurs dolara

        var ok = false;
        for (var i = 0; i < markups_settings.length; i++){
            if (!ok){
                if ((price/12.0) >= parseFloat(markups_settings[i].price_from, 10) && (price/12.0) < parseFloat(markups_settings[i].price_to, 10)){
                    markup = parseFloat(markups_settings[i].markup, 10); /* określenie marży */
                    ok = true;
                }
            }
        }

        price = price / 12.0;
        price = price * (markup / 100.0);

        if (price%1 == 0 ) {
            price = price.toFixed(0);
        } else {
            price = price.toFixed(2);
        }
        $('#vps-price-number').text(price);
    }
    var init = function () {

        $('.vpsslider').each(function(i,slider) {
            var jqSlider = $(slider);

            var steps = jqSlider.data('sliderSteps');
            var dest = jqSlider.data('sliderDest');
            var l = steps.length - 1;
            jqSlider.slider({
                range: "min",
                min: 0,
                max: l,
                animate: "fast",
                orientation: "horizontal",
                slide: function (event, ui) {
                    $('#'+dest).val(steps[ui.value]);
                    updatePrice();
                },
                create: function( event, ui ) {
                    var slider_index = jqSlider.data('sliderValue');
                    if (typeof slider_index !== 'undefined') {
                        var slider_value = steps.indexOf(slider_index);

                        if (slider_value != -1) {
                            $(this).slider("value", slider_value);
                            $('#'+dest).val(slider_index);
                        }
                    }
                }
            }).each(function () {
                var label_container = $('<div class="ui-label-container">');

                var l = steps.length - 1;
                var label_width = Number((100/steps.length).toFixed(2));
                var left_delta = -1*Number((label_width/2).toFixed(2));
                for (var i = 0; i <= l; i++) {
                    var left = ((i / l * 100)+left_delta).toFixed(2);
                    var el = $('<label class="ui-label">' + steps[i] + '</label>').css('left', left + '%').css('width', label_width+'%').css('text-align', 'center');
                    $(label_container).append(el);
                }
                $(this).append(label_container);
            });

        });
        $('input[type=radio][name=vps_backup]').change(function() {
            updatePrice();
        });
        updatePrice();
    }
    init();
})();