// collapsed tree
(function ($) {
    $.fn.tree = function (options) {
        //default configuration properities
		var defaults = {
            _rootNode:"j_treeview",
			_expandedclass: "expanded",
            handler: null
        };
        var options = $.extend(defaults, options);
        this.each(function () {
            $(this).find("li a").bind("click", function (e) {
				// toggle
				if($(this).next("ul") != null)
				{
					$(this).next("ul").toggle(130);					
				}
				if($(this).prev("ins").hasClass("collapsed"))
				{
					$(this).prev("ins").removeClass("collapsed");
					$(this).prev("ins").addClass("expanded");
					$(this).find("ins").removeClass("folder-collapsed");
					$(this).find("ins").addClass("folder-expanded");
				}
				else if($(this).prev("ins").hasClass("expanded"))
				{
					$(this).prev("ins").removeClass("expanded");
					$(this).prev("ins").addClass("collapsed");
					$(this).find("ins").addClass("folder-collapsed");
					$(this).find("ins").removeClass("folder-expanded");
				}
				if (options.handler != null && options.handler != undefined) {
					options.handler($(this))
				}
            })
			$(this).find("li>ins").bind("click", function (e) {
				// toggle
				if($(this).nextAll("ul") != null)
				{
					$(this).nextAll("ul").toggle(130);					
				}
				if($(this).hasClass("collapsed"))
				{
					$(this).removeClass("collapsed");
					$(this).addClass("expanded");
					$(this).next("a").find("ins").removeClass("folder-collapsed");
					$(this).next("a").find("ins").addClass("folder-expanded");
				}
				else
				{
					$(this).removeClass("expanded");
					$(this).addClass("collapsed");
					$(this).next("a").find("ins").addClass("folder-collapsed");
					$(this).next("a").find("ins").removeClass("folder-expanded");
				}
				if (options.handler != null && options.handler != undefined) {
					options.handler($(this))
				}
			})
        })
    }
})(jQuery);


$(function () {
	$("#leftmenu .treeview").tree({	
		_rootNode:".treeview",	
		handler: null
	});
	$("#leftmenu li a").click(function (e) {
			$(this).attr("target", "mainFrame");
		    $("#leftmenu li a.current").removeClass("current");
		    $(this).addClass("current");
	 })
	
	// folding box
    // avoid duplicate binding
    $('.box-folding .box-header').unbind("click");
    $('.box-folding .box-header').click(function (event) {
        var target = $(event.target);
		$(this).next('.box-content').toggle(300);
		$(this).children('ins').toggleClass("expanded");
		$(this).children('ins').toggleClass("collapsed");        
    })
})